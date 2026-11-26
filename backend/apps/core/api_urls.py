from django.urls import path

from .views import capabilities, health

urlpatterns = [
    path("health/", health, name="health"),
    path("capabilities/", capabilities, name="capabilities"),
]
