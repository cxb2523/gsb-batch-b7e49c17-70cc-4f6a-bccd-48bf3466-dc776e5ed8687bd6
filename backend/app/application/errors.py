
"""Application failures; HTTP status codes belong to presentation."""
class ApplicationError(Exception):
    pass

class InvalidInput(ApplicationError):
    pass

class InvalidOffer(ApplicationError):
    pass

class NotFound(ApplicationError):
    pass

class Conflict(ApplicationError):
    pass

class Unavailable(ApplicationError):
    pass

class Unauthorized(ApplicationError):
    pass

class Forbidden(ApplicationError):
    pass
