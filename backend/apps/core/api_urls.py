from django.urls import path

from apps.analysis.api import analyze_source
from apps.execution.api import create_execution

from .views import capabilities, health

urlpatterns = [
    path("health/", health, name="health"),
    path("capabilities/", capabilities, name="capabilities"),
    path("executions/", create_execution, name="create_execution"),
    path("analysis/", analyze_source, name="analyze_source"),
]
