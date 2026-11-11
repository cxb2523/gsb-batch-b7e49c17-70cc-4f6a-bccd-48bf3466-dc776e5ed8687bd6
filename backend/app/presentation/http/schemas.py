"""Signaling and source-control request contracts."""
from pydantic import BaseModel, ConfigDict, Field
from typing import Literal

class Offer(BaseModel):
    model_config = ConfigDict(extra="forbid")
    sdp: str = Field(min_length=1, max_length=100000)
    type: Literal["offer"]
    source_id: str = Field(default="camara_mari", pattern=r"^[a-zA-Z0-9_-]{1,64}$")


class ViewerOffer(BaseModel):
    model_config = ConfigDict(extra="forbid")
    sdp: str = Field(min_length=1, max_length=100000)
    type: Literal["offer"]
    session_id: str = Field(min_length=1, max_length=64)

class StartSource(BaseModel):
    model_config = ConfigDict(extra="forbid", json_schema_extra={
        "examples": [{"source_id": "camara1", "stream_path": "camera01"}]})
    source_id: str = Field(default="camara1", pattern=r"^[a-zA-Z0-9_-]{1,64}$")
    stream_path: str | None = Field(default=None, max_length=256,
                                  pattern=r"^[a-zA-Z0-9_-]+(?:/[a-zA-Z0-9_-]+)*$")
