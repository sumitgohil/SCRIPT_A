import { CommandHandler, ICommandHandler, EventBus } from '@nestjs/cqrs';
import { CreateTaskCommand } from '../create-task.command';
import { Task } from '../../entities/task.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TaskCreatedEvent } from '../../events/task-created.event';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { TaskStatus } from '../../enums/task-status.enum';
import { TaskPriority } from '../../enums/task-priority.enum';

@CommandHandler(CreateTaskCommand)
export class CreateTaskHandler implements ICommandHandler<CreateTaskCommand> {
  constructor(
    @InjectRepository(Task)
    private readonly taskRepository: Repository<Task>,
    private readonly eventBus: EventBus,
    @InjectQueue('task-processing')
    private readonly taskQueue: Queue,
  ) {}

  async execute(command: CreateTaskCommand): Promise<Task> {
    const { title, description, priority, userId, dueDate } = command;

    // Create the task
    const task = new Task();
    task.title = title;
    task.description = description;
    task.priority = priority as TaskPriority;
    task.userId = userId;
    task.dueDate = dueDate || new Date();
    task.status = TaskStatus.PENDING;
    task.createdAt = new Date();
    task.updatedAt = new Date();

    // Save the task
    const savedTask = await this.taskRepository.save(task);

    // Publish the event
    this.eventBus.publish(new TaskCreatedEvent(savedTask.id, savedTask.title, savedTask.userId));

    // Add to processing queue
    try {
      await this.taskQueue.add('task-status-update', {
        taskId: savedTask.id,
        status: savedTask.status,
      });
    } catch (queueError) {
      // Log error but don't fail the operation
      console.error('Failed to add task to queue:', queueError);
    }

    return savedTask;
  }
}
