import { EventsHandler, IEventHandler } from '@nestjs/cqrs';
import { TaskCreatedEvent } from '../task-created.event';
import { Logger } from '@nestjs/common';

@EventsHandler(TaskCreatedEvent)
export class TaskCreatedHandler implements IEventHandler<TaskCreatedEvent> {
  private readonly logger = new Logger(TaskCreatedHandler.name);

  handle(event: TaskCreatedEvent) {
    this.logger.log(
      `Task created: ${event.title} (ID: ${event.taskId}) by user ${event.userId} at ${event.timestamp}`,
    );

    // In a real application, you might:
    // - Send notifications
    // - Update analytics
    // - Trigger workflows
    // - Update search indexes
    // - Send webhooks
  }
}
