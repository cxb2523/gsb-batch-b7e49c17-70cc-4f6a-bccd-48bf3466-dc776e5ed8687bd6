"""Read use cases shared by detection, alert and operational log repositories."""
from app.application.errors import InvalidInput, NotFound, Unavailable
from app.application.ports import AlertRepository, DetectionRepository, LogRepository


class RecordQueries:
    def __init__(self, repository: AlertRepository | DetectionRepository | LogRepository,
                 *, unavailable: str, missing: str):
        self.repository = repository
        self.unavailable = unavailable
        self.missing = missing

    def list(self, *args, **filters):
        date_from, date_to = filters.get("date_from"), filters.get("date_to")
        if date_from is not None and date_to is not None and date_from > date_to:
            raise InvalidInput("date_from debe ser menor o igual a date_to")
        try:
            return self.repository.list(*args, **filters)
        except Exception:
            raise Unavailable(self.unavailable) from None

    def get(self, identifier):
        try:
            record = self.repository.get(identifier)
        except Exception:
            raise Unavailable(self.unavailable) from None
        if record is None:
            raise NotFound(self.missing)
        return record
