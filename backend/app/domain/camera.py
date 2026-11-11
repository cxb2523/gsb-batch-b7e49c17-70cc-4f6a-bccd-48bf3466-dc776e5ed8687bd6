"""Camera configuration and validation without persistence."""
import ipaddress
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator, model_validator

class CameraRegistration(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source_id: str = Field(pattern=r"^[a-zA-Z0-9_-]{1,64}$")
    name: str = Field(default="", max_length=128)
    stream_path: str = Field(default="camera01", max_length=256,
                             pattern=r"^[a-zA-Z0-9_-]+(?:/[a-zA-Z0-9_-]+)*$")
    protocol: Literal["rtsp", "rtsps"] = "rtsp"
    host: str = "184.194.94.182"
    port: int = Field(default=8554, ge=1, le=65535)
    user: str = Field(default="viewer", min_length=1, max_length=128)
    password: SecretStr = Field(default=SecretStr(""), max_length=1024)
    fingerprint: str = ""
    enabled: bool = True

    @field_validator("host")
    @classmethod
    def valid_host(cls, value):
        return str(ipaddress.IPv4Address(value))

    @field_validator("fingerprint")
    @classmethod
    def valid_fingerprint(cls, value):
        value = value.replace(":", "").strip().upper()
        if value and (len(value) != 64 or any(c not in "0123456789ABCDEF" for c in value)):
            raise ValueError("Debe ser una huella SHA-256 hexadecimal")
        return value

    @model_validator(mode="after")
    def validate_tls(self):
        if self.protocol == "rtsps" and not self.fingerprint:
            raise ValueError("RTSPS requiere huella SHA-256")
        return self

    def private_config(self):
        result = self.model_dump(exclude={"password"})
        result["password"] = self.password.get_secret_value()
        return result

    def public_config(self):
        return {**self.model_dump(exclude={"password"}),
                "has_password": bool(self.password.get_secret_value())}
