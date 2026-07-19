"""HTTP route adapter kept inside the Map Making App plugin boundary."""


class MapMakingAppRoutes:
    PREFIX = "/api/mma-sync"

    def __init__(self, service):
        self.service = service

    @classmethod
    def handles(cls, path):
        return path == cls.PREFIX or path.startswith(cls.PREFIX + "/")

    def requires_exclusive_sync(self, method, path):
        subpath = path[len(self.PREFIX):] or "/"
        return (method == "PUT" and subpath == "/key") or (
            method == "POST" and subpath == "/run"
        )

    def dispatch(self, method, path, body):
        subpath = path[len(self.PREFIX):] or "/"
        try:
            if method == "GET" and subpath == "/status":
                return self.service.public_status(), 200
            if method == "PUT" and subpath == "/config":
                return self.service.set_enabled(bool(body.get("enabled"))), 200
            if method == "PUT" and subpath == "/key":
                return self.service.save_key(body.get("apiKey")), 200
            if method == "DELETE" and subpath == "/key":
                return self.service.forget_key(), 200
            if method == "POST" and subpath == "/run":
                return self.service.start(), 202
            return {"error": "not found"}, 404
        except (RuntimeError, ValueError) as exc:
            return {"error": str(exc)}, 400
