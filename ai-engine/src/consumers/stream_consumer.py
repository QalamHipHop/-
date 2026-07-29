"""Kafka consumer that runs scoring on every relevant event and emits
`rial.ai.signals.v1` back to the bus.

This is the production wiring: trades flow in → risk/fraud scored → signals
flow out. The consumer is idempotent and tolerant to slow model loads.
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from kafka import KafkaConsumer, KafkaProducer

from src.common.config import get_settings
from src.scoring.risk_scorer import fraud_score, risk_score, rugpull_score

log = logging.getLogger(__name__)


class StreamScorer:
    def __init__(self) -> None:
        self.settings = get_settings()
        self._consumer: KafkaConsumer | None = None
        self._producer: KafkaProducer | None = None
        self._stop = asyncio.Event()

    async def start(self) -> None:
        self._consumer = KafkaConsumer(
            self.settings.topic_trades,
            self.settings.topic_launches,
            bootstrap_servers=self.settings.kafka_broker_list,
            group_id="rial-ai-engine",
            enable_auto_commit=True,
            auto_offset_reset="latest",
            value_deserializer=lambda v: json.loads(v.decode("utf-8")),
        )
        self._producer = KafkaProducer(
            bootstrap_servers=self.settings.kafka_broker_list,
            value_serializer=lambda v: json.dumps(v).encode("utf-8"),
        )
        log.info("ai-engine consumer ready")
        await self._loop()

    async def stop(self) -> None:
        self._stop.set()
        if self._consumer:
            self._consumer.close()
        if self._producer:
            self._producer.flush(timeout=5)
            self._producer.close()

    async def _loop(self) -> None:
        assert self._consumer is not None
        while not self._stop.is_set():
            # poll returns dict[TopicPartition, list[ConsumerRecord]]
            batches = self._consumer.poll(timeout_ms=500)
            for _tp, records in batches.items():
                for rec in records:
                    try:
                        await self._handle(rec.topic, rec.value)
                    except Exception as e:  # noqa: BLE001
                        log.exception("handle failed topic=%s err=%s", rec.topic, e)

    async def _handle(self, topic: str, value: dict[str, Any]) -> None:
        if topic == self.settings.topic_trades:
            sig = fraud_score(
                from_address=value.get("maker", ""),
                to_address=value.get("taker", ""),
                value=float(value.get("totalRial", 0) or 0),
            )
            await self._emit("fraud", value.get("maker") or value.get("taker") or "", sig)
        elif topic == self.settings.topic_launches:
            sig = rugpull_score(
                name=value.get("name", ""),
                description=value.get("description", ""),
                creator_address=value.get("creator", ""),
            )
            await self._emit("rugpull", value.get("symbol", ""), sig)
        elif topic == self.settings.topic_user_actions:
            sig = risk_score(
                address=value.get("address", ""),
                history=value.get("history", []),
            )
            await self._emit("risk", value.get("address", ""), sig)

    async def _emit(self, kind: str, target: str, sig: dict[str, Any]) -> None:
        if not self._producer:
            return
        await asyncio.to_thread(
            self._producer.send,
            self.settings.topic_ai_signals,
            {
                "target": target,
                "kind": kind,
                "score": sig["score"],
                "evidence": sig.get("evidence", {}),
                "ts": int(asyncio.get_event_loop().time() * 1000),
            },
        )


async def main() -> None:
    from src.common.logging import setup_logging
    settings = get_settings()
    setup_logging(settings.ai_log_level)
    s = StreamScorer()
    try:
        await s.start()
    except KeyboardInterrupt:
        await s.stop()


if __name__ == "__main__":
    asyncio.run(main())
