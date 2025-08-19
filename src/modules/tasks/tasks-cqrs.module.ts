import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Task } from './entities/task.entity';
import { BullModule } from '@nestjs/bullmq';

// Commands
import { CreateTaskHandler } from './commands/handlers/create-task.handler';

// Queries
import { GetTasksHandler } from './queries/handlers/get-tasks.handler';

// Events
import { TaskCreatedHandler } from './events/handlers/task-created.handler';

// All handlers
const CommandHandlers = [CreateTaskHandler];
const QueryHandlers = [GetTasksHandler];
const EventHandlers = [TaskCreatedHandler];

@Module({
  imports: [
    CqrsModule,
    TypeOrmModule.forFeature([Task]),
    BullModule.registerQueue({
      name: 'task-processing',
    }),
  ],
  providers: [
    ...CommandHandlers,
    ...QueryHandlers,
    ...EventHandlers,
  ],
  exports: [
    CqrsModule,
    ...CommandHandlers,
    ...QueryHandlers,
    ...EventHandlers,
  ],
})
export class TasksCqrsModule {}
