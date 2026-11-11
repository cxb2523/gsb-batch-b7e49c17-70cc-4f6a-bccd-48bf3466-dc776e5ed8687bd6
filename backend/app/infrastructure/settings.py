
"""Environment access is confined to the outer layers."""
import json
import os
from app.domain.alerts import EventPolicy
from app.domain.pipeline import PipelineConfig

def pipeline_config():
    return PipelineConfig(fps=float(os.getenv('TA2_FPS', '4')),
                          width=int(os.getenv('TA2_WIDTH', '64')),
                          height=int(os.getenv('TA2_HEIGHT', '64')),
                          window_size=int(os.getenv('TA2_WINDOW_SIZE', '8')),
                          queue_size=int(os.getenv('TA2_QUEUE_SIZE', '2')))

def event_policy():
    value = os.getenv('SENTRIX_ALERT_THRESHOLDS')
    return EventPolicy(json.loads(value) if value else None)
