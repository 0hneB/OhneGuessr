package mapfile

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path"
	"path/filepath"
	"strings"
	"unicode"
)

const maxNameRunes = 120

var windowsNames = map[string]bool{
	"con": true, "prn": true, "aux": true, "nul": true,
	"com1": true, "com2": true, "com3": true, "com4": true, "com5": true,
	"com6": true, "com7": true, "com8": true, "com9": true,
	"lpt1": true, "lpt2": true, "lpt3": true, "lpt4": true, "lpt5": true,
	"lpt6": true, "lpt7": true, "lpt8": true, "lpt9": true,
}

func IsWindowsName(value string) bool {
	return windowsNames[strings.ToLower(value)]
}

func SafeComponent(value, fallback string) string {
	var output []rune
	space := false
	for _, char := range strings.TrimSpace(value) {
		if char < 32 || strings.ContainsRune(`<>:"/\|?*`, char) {
			char = '-'
		}
		if unicode.IsSpace(char) {
			if space {
				continue
			}
			char = ' '
			space = true
		} else {
			space = false
		}
		output = append(output, char)
	}
	result := strings.TrimRight(strings.TrimSpace(string(output)), ". ")
	if result == "" || result == "." || result == ".." {
		result = fallback
	}
	if IsWindowsName(result) {
		result += "-map"
	}
	runes := []rune(result)
	if len(runes) > maxNameRunes {
		result = string(runes[:maxNameRunes])
	}
	result = strings.TrimRight(result, ". ")
	if result == "" {
		return fallback
	}
	return result
}

func Folder(rel string) string {
	folder := path.Dir(rel)
	if folder == "." {
		return ""
	}
	return folder
}

func FoldersOutsideRoot(folders []string, root string) []string {
	result := make([]string, 0, len(folders))
	for _, folder := range folders {
		if !UnderRoot(folder, root) {
			result = append(result, folder)
		}
	}
	return result
}

func UnderRoot(rel, root string) bool {
	return strings.EqualFold(rel, root) || strings.HasPrefix(strings.ToLower(rel), strings.ToLower(root)+"/")
}

func SourceType(source map[string]any) string {
	value, _ := source["type"].(string)
	return value
}

func Checksum(value []byte) string {
	digest := sha256.Sum256(value)
	return "sha256:" + hex.EncodeToString(digest[:])
}

func WriteJSON(filename string, value any, permission os.FileMode) error {
	encoded, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	return Write(filename, append(encoded, '\n'), permission)
}

func Write(filename string, value []byte, permission os.FileMode) (err error) {
	if err := os.MkdirAll(filepath.Dir(filename), 0o755); err != nil {
		return err
	}
	temporary, err := os.CreateTemp(filepath.Dir(filename), ".ohneguessr-*.tmp")
	if err != nil {
		return err
	}
	temporaryName := temporary.Name()
	defer func() {
		_ = temporary.Close()
		if err != nil {
			_ = os.Remove(temporaryName)
		}
	}()
	if err = temporary.Chmod(permission); err == nil {
		_, err = temporary.Write(value)
	}
	if err == nil {
		err = temporary.Sync()
	}
	if closeErr := temporary.Close(); err == nil {
		err = closeErr
	}
	if err == nil {
		err = os.Rename(temporaryName, filename)
	}
	return err
}

func RemoveEmptyDirectories(base, root string) {
	rootPath := filepath.Join(base, filepath.FromSlash(root))
	info, err := os.Lstat(rootPath)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return
	}
	directories := make([]string, 0)
	_ = filepath.WalkDir(rootPath, func(filename string, entry os.DirEntry, err error) error {
		if err == nil && entry.IsDir() && entry.Type()&os.ModeSymlink == 0 {
			directories = append(directories, filename)
		}
		return nil
	})
	for index := len(directories) - 1; index >= 0; index-- {
		_ = os.Remove(directories[index])
	}
}
