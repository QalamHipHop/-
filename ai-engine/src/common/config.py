"""Configuration loaded from environment with sane defaults for local dev."""
from __future__ import annotations

import os
from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    ai_port: int = 3020
    ai_log_level: str = "info"
    kafka_brokers: str = "localhost:9092"
    redis_url: str = "redis://localhost:6379/0"
    model_dir: str = "/var/lib/rial/models"

    # Decision thresholds (above => reject / flag)
    risk_threshold: float = 0.95
    fraud_threshold: float = 0.90
    rugpull_threshold: float = 0.90

    # Kafka topics
    topic_trades: str = "rial.trades.v1"
    topic_launches: str = "rial.launches.v1"
    topic_user_actions: str = "rial.user_actions.v1"
    topic_ai_signals: str = "rial.ai.signals.v1"

    @property
    def kafka_broker_list(self) -> list[str]:
        return [b.strip() for b in self.kafka_brokers.split(",") if b.strip()]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
