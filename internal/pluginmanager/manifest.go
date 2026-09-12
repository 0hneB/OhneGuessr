package pluginmanager

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"reflect"
	"slices"
	"strings"
)

const pluginAPIVersion = 1

type PluginSetting struct {
	Key   string `json:"key"`
	Label string `json:"label"`
	Type  string `json:"type"`
}

type PluginManifest struct {
	ID           string          `json:"id"`
	Name         string          `json:"name"`
	Description  string          `json:"description"`
	Icon         string          `json:"icon"`
	Version      string          `json:"version"`
	APIVersion   int             `json:"apiVersion"`
	Main         string          `json:"main"`
	Experimental bool            `json:"experimental,omitempty"`
	Settings     []PluginSetting `json:"settings,omitempty"`
	SHA256       string          `json:"sha256,omitempty"`
}

type PluginInfo struct {
	ID           string          `json:"id"`
	Name         string          `json:"name"`
	Description  string          `json:"description"`
	Icon         string          `json:"icon"`
	Version      string          `json:"version"`
	APIVersion   int             `json:"apiVersion"`
	Main         string          `json:"main"`
	Experimental bool            `json:"experimental,omitempty"`
	Settings     []PluginSetting `json:"settings,omitempty"`
	Configured   []string        `json:"configured,omitempty"`
	Enabled      bool            `json:"enabled"`
}

type PluginModule struct {
	Manifest PluginManifest `json:"manifest"`
	Source   string         `json:"source"`
}

func validatePluginID(id string) error {
	if len(id) == 0 || len(id) > 64 || id[0] == '-' || id[len(id)-1] == '-' {
		return errors.New("invalid plugin id")
	}
	for _, char := range id {
		if (char < 'a' || char > 'z') && (char < '0' || char > '9') && char != '-' {
			return errors.New("invalid plugin id")
		}
	}
	return nil
}

func validatePluginSettingKey(key string) error {
	if len(key) == 0 || len(key) > 64 || !asciiLetter(key[0]) {
		return errors.New("invalid plugin setting key")
	}
	for index := 1; index < len(key); index++ {
		char := key[index]
		if !asciiLetter(char) && (char < '0' || char > '9') && char != '-' && char != '_' {
			return errors.New("invalid plugin setting key")
		}
	}
	return nil
}

func asciiLetter(char byte) bool {
	return char >= 'a' && char <= 'z' || char >= 'A' && char <= 'Z'
}

func validatePluginManifest(manifest PluginManifest, expectedID string, requireHash bool) error {
	if err := validatePluginID(manifest.ID); err != nil || manifest.ID != expectedID {
		return errors.New("plugin manifest has an invalid id")
	}
	if name := strings.TrimSpace(manifest.Name); name == "" || len(name) > 80 {
		return errors.New("plugin manifest has an invalid name")
	}
	if len(manifest.Description) > 500 || len(manifest.Icon) == 0 || len(manifest.Icon) > 8192 {
		return errors.New("plugin manifest has invalid display metadata")
	}
	if version := strings.TrimSpace(manifest.Version); version == "" || len(version) > 40 {
		return errors.New("plugin manifest has an invalid version")
	}
	if manifest.APIVersion != pluginAPIVersion {
		return fmt.Errorf("plugin %q requires unsupported API version %d", manifest.ID, manifest.APIVersion)
	}
	if manifest.Main != "index.js" {
		return errors.New("plugin entry point must be index.js")
	}
	if len(manifest.Settings) > 16 {
		return errors.New("plugin manifest has too many settings")
	}
	seenSettings := make(map[string]bool, len(manifest.Settings))
	for _, setting := range manifest.Settings {
		if validatePluginSettingKey(setting.Key) != nil || seenSettings[setting.Key] {
			return errors.New("plugin manifest has an invalid setting key")
		}
		if label := strings.TrimSpace(setting.Label); label == "" || len(label) > 80 || setting.Type != "password" {
			return errors.New("plugin manifest has an invalid setting")
		}
		seenSettings[setting.Key] = true
	}
	if requireHash && !validPluginChecksum(manifest.SHA256) {
		return errors.New("plugin manifest has an invalid checksum")
	}
	return nil
}

func samePluginManifest(left, right PluginManifest) bool {
	left.SHA256 = ""
	right.SHA256 = ""
	return reflect.DeepEqual(left, right)
}

func pluginChecksum(contents []byte) string {
	digest := sha256.Sum256(contents)
	return "sha256:" + hex.EncodeToString(digest[:])
}

func validPluginChecksum(value string) bool {
	if !strings.HasPrefix(value, "sha256:") || len(value) != len("sha256:")+sha256.Size*2 {
		return false
	}
	_, err := hex.DecodeString(strings.TrimPrefix(value, "sha256:"))
	return err == nil
}

func pluginDeclaresSetting(manifest PluginManifest, key string) bool {
	return slices.ContainsFunc(manifest.Settings, func(setting PluginSetting) bool { return setting.Key == key })
}

func pluginInfo(manifest PluginManifest, enabled bool, configured []string) PluginInfo {
	return PluginInfo{
		ID: manifest.ID, Name: manifest.Name, Description: manifest.Description,
		Icon: manifest.Icon, Version: manifest.Version, APIVersion: manifest.APIVersion,
		Main: manifest.Main, Experimental: manifest.Experimental, Settings: manifest.Settings,
		Configured: configured, Enabled: enabled,
	}
}
