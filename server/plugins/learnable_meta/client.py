"""Small, fixed-origin HTTP client for Learnable Meta's userscript API."""

import json
import time
import urllib.error
import urllib.parse
import urllib.request


API_BASE = "https://learnablemeta.com"
USER_AGENT = "OhneGuessr/1 Learnable-Meta-Sync"
MAX_LOCATIONS_RESPONSE = 32 * 1024 * 1024
MAX_CLUE_RESPONSE = 2 * 1024 * 1024


class LearnableMetaApiError(RuntimeError):
    def __init__(self, message, status=502):
        super().__init__(message)
        self.status = status


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, _request, _file_pointer, _code, _message, _headers, _new_url):
        return None


def _safe_error_message(status):
    if status == 401:
        return "Learnable Meta rejected the API key"
    if status == 403:
        return "The API key cannot access this Learnable Meta map"
    if status == 404:
        return "Learnable Meta map not found"
    if status == 429:
        return "Learnable Meta is rate limiting requests; try again shortly"
    return "Learnable Meta request failed (HTTP %d)" % status


class LearnableMetaClient:
    def __init__(self, opener=None, timeout=20):
        self._opener = opener or urllib.request.build_opener(_NoRedirect()).open
        self.timeout = timeout

    def _get_json(self, url, *, api_key=None, max_bytes, retries=1):
        headers = {
            "Accept": "application/json",
            "User-Agent": USER_AGENT,
        }
        if api_key:
            headers["Authorization"] = "Bearer " + api_key

        last_error = None
        for attempt in range(retries + 1):
            request = urllib.request.Request(url, method="GET", headers=headers)
            try:
                with self._opener(request, timeout=self.timeout) as response:
                    length = response.headers.get("Content-Length")
                    if length and int(length) > max_bytes:
                        raise LearnableMetaApiError("Learnable Meta response is too large")
                    raw = response.read(max_bytes + 1)
                    if len(raw) > max_bytes:
                        raise LearnableMetaApiError("Learnable Meta response is too large")
                    try:
                        return json.loads(raw.decode("utf-8"))
                    except (ValueError, UnicodeDecodeError) as exc:
                        raise LearnableMetaApiError("Learnable Meta returned invalid JSON") from exc
            except urllib.error.HTTPError as exc:
                status = int(exc.code)
                last_error = LearnableMetaApiError(_safe_error_message(status), status=status)
                if status != 429 and not 500 <= status < 600:
                    break
            except LearnableMetaApiError:
                raise
            except (urllib.error.URLError, TimeoutError, OSError, ValueError) as exc:
                last_error = LearnableMetaApiError("Could not reach Learnable Meta: " + str(exc))
            if attempt < retries:
                time.sleep(0.4 * (attempt + 1))
        raise last_error or LearnableMetaApiError("Learnable Meta request failed")

    def fetch_locations(self, map_id, api_key):
        quoted = urllib.parse.quote(map_id, safe="")
        url = "%s/api/userscript/map/%s/locations" % (API_BASE, quoted)
        data = self._get_json(
            url,
            api_key=api_key,
            max_bytes=MAX_LOCATIONS_RESPONSE,
            retries=1,
        )
        coordinates = data.get("customCoordinates") if isinstance(data, dict) else None
        if not isinstance(coordinates, list):
            raise LearnableMetaApiError("Learnable Meta returned invalid location data")
        return coordinates

    def fetch_clue(self, map_id, pano_id):
        query = urllib.parse.urlencode({"mapId": map_id, "panoId": pano_id})
        url = "%s/api/userscript/location?%s" % (API_BASE, query)
        return self._get_json(url, max_bytes=MAX_CLUE_RESPONSE, retries=0)
