import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { Notification, NotificationChannel, SendResult } from './notifications.types';

interface SendBody {
  id?: string;
  channel: NotificationChannel;
  recipient: string;
  subject?: string;
  body: string;
  data?: Record<string, unknown>;
  correlationId?: string;
}

interface FanoutBody extends Omit<SendBody, 'channel'> {
  channels: NotificationChannel[];
}

@Controller('v1/notifications')
export class NotificationsController {
  constructor(private readonly svc: NotificationsService) {}

  @Get('channels')
  channels(): NotificationChannel[] {
    return this.svc.availableChannels();
  }

  @Post('send')
  @HttpCode(HttpStatus.ACCEPTED)
  async send(@Body() body: SendBody): Promise<SendResult> {
    return this.svc.send(body as Notification);
  }

  @Post('fanout')
  @HttpCode(HttpStatus.ACCEPTED)
  async fanout(@Body() body: FanoutBody): Promise<SendResult[]> {
    const { channels, ...rest } = body;
    return this.svc.fanout(rest as Notification, channels);
  }
}
