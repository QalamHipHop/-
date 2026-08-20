/**
 *  Events module — NATS publisher + Kafka audit sink.
 *  Feature modules publish domain events via EventBus; we add an audit mirror
 *  by also writing to Kafka (per ADR-0006 / 0008).
 */
import { Module } from '@nestjs/common';
import { EventBusService } from './event-bus.service';
import { AuditSinkService } from './audit-sink.service';
import { OutboxWorker } from './outbox.worker';

@Module({
  providers: [EventBusService, AuditSinkService, OutboxWorker],
  exports: [EventBusService, AuditSinkService],
})
export class EventsModule {}
