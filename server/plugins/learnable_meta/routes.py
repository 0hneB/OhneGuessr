"""HTTP route adapter kept inside the Learnable Meta plugin boundary."""

from .client import LearnableMetaApiError


class LearnableMetaRoutes:
    PREFIX = "/api/learnable-meta"

    def __init__(self, service):
        self.service = service

    @classmethod
    def handles(cls, path):
        return path == cls.PREFIX or path.startswith(cls.PREFIX + "/")

    def dispatch(self, method, path, query, body):
        subpath = path[len(self.PREFIX):] or "/"
        try:
            if method == "GET" and subpath == "/status":
                return self.service.public_status(), 200
            if method == "GET" and subpath == "/clue":
                map_id = self._one(query, "mapId")
                pano_id = self._one(query, "panoId")
                return self.service.get_clue(map_id, pano_id), 200
            if method == "PUT" and subpath == "/settings":
                return self.service.set_enabled(bool(body.get("enabled"))), 200
            if method == "PUT" and subpath == "/key":
                return self.service.save_key(body.get("apiKey")), 200
            if method == "DELETE" and subpath == "/key":
                return self.service.forget_key(), 200
            if method == "POST" and subpath == "/maps":
                return self.service.add_map(body.get("mapId"), body.get("name")), 201
            if method == "PATCH" and subpath == "/maps":
                return self.service.rename_map(body.get("mapId"), body.get("name")), 200
            if method == "DELETE" and subpath == "/maps":
                return self.service.remove_map(body.get("mapId")), 200
            if method == "POST" and subpath == "/sync":
                return self.service.start(), 202
            return {"error": "not found"}, 404
        except LearnableMetaApiError as exc:
            status = exc.status if exc.status in (401, 403, 404, 429) else 502
            return {"error": str(exc)}, status
        except KeyError as exc:
            return {"error": str(exc).strip("'")}, 404
        except RuntimeError as exc:
            return {"error": str(exc)}, 409
        except ValueError as exc:
            return {"error": str(exc)}, 400

    @staticmethod
    def _one(query, name):
        values = query.get(name) or []
        return values[0] if values else ""
