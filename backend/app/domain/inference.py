"""Validated inference values, independent of HTTP and storage."""
from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator

FiniteNumber = Annotated[float, Field(strict=True, allow_inf_nan=False)]
Pixel = Annotated[FiniteNumber, Field(ge=0, le=1)]
Classes = Literal["Normal", "Hurto", "Robo", "Agresión física", "Vandalismo"]

class Window(BaseModel):
    model_config = ConfigDict(extra="forbid")
    timestamp: Annotated[FiniteNumber, Field(ge=0)]
    source_id: str = Field(default="camara_mari", pattern=r"^[a-zA-Z0-9_-]{1,64}$")
    frames: list[list[list[list[Pixel]]]] = Field(min_length=1, max_length=32)

    @model_validator(mode="after")
    def check_shape(self):
        # Contrato provisional THWC: tiempo, alto, ancho, canales RGB.
        height = len(self.frames[0])
        width = len(self.frames[0][0]) if height else 0
        if not 1 <= height <= 224 or not 1 <= width <= 224:
            raise ValueError("Alto y ancho deben estar entre 1 y 224")
        for frame in self.frames:
            if len(frame) != height:
                raise ValueError("Todos los frames deben tener el mismo alto")
            for row in frame:
                if len(row) != width:
                    raise ValueError("Todas las filas deben tener el mismo ancho")
                if any(len(pixel) != 3 for pixel in row):
                    raise ValueError("Cada pixel debe contener tres canales RGB")
        return self

class Prediction(BaseModel):
    model_config = ConfigDict(extra="forbid")
    clase: Classes
    confianza: Annotated[FiniteNumber, Field(ge=0, le=1)]
    timestamp: Annotated[FiniteNumber, Field(ge=0)]
    simulated: bool
    probabilities: dict[str, Annotated[FiniteNumber, Field(ge=0, le=1)]] | None = None
