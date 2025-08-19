import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { Task } from '../../modules/tasks/entities/task.entity';
import { TaskStatus } from '../../modules/tasks/enums/task-status.enum';

@Injectable()
export class OverdueTasksService {
  private readonly logger = new Logger(OverdueTasksService.name);

  constructor(
    @InjectQueue('task-processing')
    private taskQueue: Queue,
    @InjectRepository(Task)
    private tasksRepository: Repository<Task>,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async checkOverdueTasks() {
    this.logger.debug('Checking for overdue tasks...');
    
    try {
      const now = new Date();
      const overdueTasks = await this.tasksRepository.find({
        where: {
          dueDate: LessThan(now),
          status: TaskStatus.PENDING,
        },
        select: ['id', 'title', 'dueDate', 'userId'],
        take: 100, // Limit to prevent memory issues
      });
      
      this.logger.log(`Found ${overdueTasks.length} overdue tasks`);
      
      if (overdueTasks.length > 0) {
        // Process overdue tasks in batches for better performance
        const batchSize = 10;
        for (let i = 0; i < overdueTasks.length; i += batchSize) {
          const batch = overdueTasks.slice(i, i + batchSize);
          
          // Add batch to the queue with proper error handling
          try {
            await this.taskQueue.add('overdue-tasks-notification', {
              tasks: batch,
              timestamp: now.toISOString(),
            }, {
              delay: 5000, // 5 second delay to avoid overwhelming the system
              attempts: 3,
              backoff: {
                type: 'exponential',
                delay: 2000,
              },
            });
            
            this.logger.debug(`Added batch ${Math.floor(i / batchSize) + 1} to queue`);
          } catch (queueError) {
            this.logger.error(`Failed to add batch ${Math.floor(i / batchSize) + 1} to queue:`, queueError);
          }
        }
      }
      
      this.logger.debug('Overdue tasks check completed successfully');
    } catch (error) {
      this.logger.error('Error checking overdue tasks:', error);
      throw error;
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async checkTasksDueSoon() {
    this.logger.debug('Checking for tasks due soon...');
    
    try {
      const now = new Date();
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours from now
      
      const tasksDueSoon = await this.tasksRepository.find({
        where: {
          dueDate: LessThan(tomorrow),
          status: TaskStatus.PENDING,
        },
        select: ['id', 'title', 'dueDate', 'userId'],
        take: 50, // Limit to prevent memory issues
      });
      
      this.logger.log(`Found ${tasksDueSoon.length} tasks due soon`);
      
      if (tasksDueSoon.length > 0) {
        // Add reminder jobs to the queue
        try {
          await this.taskQueue.add('due-soon-reminder', {
            tasks: tasksDueSoon,
            timestamp: now.toISOString(),
          }, {
            delay: 10000, // 10 second delay
            attempts: 2,
            backoff: {
              type: 'exponential',
              delay: 5000,
            },
          });
          
          this.logger.debug('Added due soon reminder to queue');
        } catch (queueError) {
          this.logger.error('Failed to add due soon reminder to queue:', queueError);
        }
      }
      
      this.logger.debug('Tasks due soon check completed successfully');
    } catch (error) {
      this.logger.error('Error checking tasks due soon:', error);
      throw error;
    }
  }
} 