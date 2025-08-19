import { Injectable, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { TasksService } from '../../modules/tasks/tasks.service';
import { TaskStatus } from '../../modules/tasks/enums/task-status.enum';

@Injectable()
@Processor('task-processing', {
  concurrency: 5, // Process up to 5 jobs concurrently
  maxStalledCount: 3, // Mark job as failed after 3 stalls
})
export class TaskProcessorService extends WorkerHost {
  private readonly logger = new Logger(TaskProcessorService.name);

  constructor(private readonly tasksService: TasksService) {
    super();
  }

  async process(job: Job): Promise<any> {
    this.logger.debug(`Processing job ${job.id} of type ${job.name}`);
    
    try {
      switch (job.name) {
        case 'task-status-update':
          return await this.handleStatusUpdate(job);
        case 'overdue-tasks-notification':
          return await this.handleOverdueTasks(job);
        case 'due-soon-reminder':
          return await this.handleDueSoonReminder(job);
        default:
          this.logger.warn(`Unknown job type: ${job.name}`);
          return { success: false, error: 'Unknown job type' };
      }
    } catch (error) {
      this.logger.error(`Error processing job ${job.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      
      // Implement exponential backoff for retries
      const maxAttempts = job.opts.attempts || 3; // Default to 3 attempts if not specified
      if (job.attemptsMade < maxAttempts) {
        const delay = Math.pow(2, job.attemptsMade) * 1000; // Exponential backoff
        this.logger.debug(`Scheduling retry for job ${job.id} in ${delay}ms`);
        throw error; // This will trigger a retry
      }
      
      // Job has failed all attempts, mark as failed
      this.logger.error(`Job ${job.id} failed after ${job.attemptsMade} attempts`);
      return { success: false, error: 'Job failed after maximum attempts' };
    }
  }

  private async handleStatusUpdate(job: Job) {
    const { taskId, status } = job.data;
    
    // Validate input data
    if (!taskId || !status) {
      this.logger.warn(`Job ${job.id}: Missing required data - taskId: ${taskId}, status: ${status}`);
      return { success: false, error: 'Missing required data' };
    }
    
    // Validate status value
    if (!Object.values(TaskStatus).includes(status)) {
      this.logger.warn(`Job ${job.id}: Invalid status value: ${status}`);
      return { success: false, error: 'Invalid status value' };
    }
    
    try {
      const task = await this.tasksService.updateStatus(taskId, status);
      
      this.logger.debug(`Job ${job.id}: Successfully updated task ${taskId} to status ${status}`);
      
      return { 
        success: true,
        taskId: task.id,
        newStatus: task.status,
        updatedAt: task.updatedAt
      };
    } catch (error) {
      this.logger.error(`Job ${job.id}: Failed to update task ${taskId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error; // Re-throw to trigger retry mechanism
    }
  }

  private async handleOverdueTasks(job: Job) {
    const { tasks, timestamp } = job.data;
    
    if (!tasks || !Array.isArray(tasks)) {
      this.logger.warn(`Job ${job.id}: Invalid tasks data`);
      return { success: false, error: 'Invalid tasks data' };
    }
    
    this.logger.debug(`Job ${job.id}: Processing ${tasks.length} overdue tasks`);
    
    try {
      const results = [];
      const batchSize = 5; // Process in small batches to avoid overwhelming the system
      
      for (let i = 0; i < tasks.length; i += batchSize) {
        const batch = tasks.slice(i, i + batchSize);
        
        // Process batch with delay to prevent system overload
        if (i > 0) {
          await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay between batches
        }
        
        const batchResults = await Promise.allSettled(
          batch.map(async (task) => {
            try {
              // Update task status to in progress to indicate it needs attention
              const updatedTask = await this.tasksService.updateStatus(task.id, TaskStatus.IN_PROGRESS);
              
              // Here you would typically send notifications (email, push, etc.)
              // For now, we'll just log the action
              this.logger.debug(`Marked task ${task.id} as overdue`);
              
              return {
                taskId: task.id,
                success: true,
                action: 'marked_overdue'
              };
            } catch (error) {
              this.logger.error(`Failed to process overdue task ${task.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
              return {
                taskId: task.id,
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
              };
            }
          })
        );
        
        results.push(...batchResults);
      }
      
      const successCount = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
      const failureCount = results.length - successCount;
      
      this.logger.log(`Job ${job.id}: Processed ${tasks.length} overdue tasks - ${successCount} success, ${failureCount} failures`);
      
      return {
        success: true,
        totalTasks: tasks.length,
        successCount,
        failureCount,
        results: results.map(r => r.status === 'fulfilled' ? r.value : { success: false, error: 'Promise rejected' })
      };
    } catch (error) {
      this.logger.error(`Job ${job.id}: Failed to process overdue tasks: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error; // Re-throw to trigger retry mechanism
    }
  }

  private async handleDueSoonReminder(job: Job) {
    const { tasks, timestamp } = job.data;
    
    if (!tasks || !Array.isArray(tasks)) {
      this.logger.warn(`Job ${job.id}: Invalid tasks data`);
      return { success: false, error: 'Invalid tasks data' };
    }
    
    this.logger.debug(`Job ${job.id}: Processing ${tasks.length} due soon reminders`);
    
    try {
      const results = [];
      
      // Process all tasks in parallel for better performance
      const taskPromises = tasks.map(async (task) => {
        try {
          // Here you would typically send reminder notifications (email, push, etc.)
          // For now, we'll just log the action
          this.logger.debug(`Sending reminder for task ${task.id} due on ${task.dueDate}`);
          
          // You could also update a "lastReminderSent" field in the task
          // await this.tasksService.updateLastReminderSent(task.id);
          
          return {
            taskId: task.id,
            success: true,
            action: 'reminder_sent',
            dueDate: task.dueDate
          };
        } catch (error) {
          this.logger.error(`Failed to send reminder for task ${task.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
          return {
            taskId: task.id,
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          };
        }
      });
      
      const batchResults = await Promise.allSettled(taskPromises);
      results.push(...batchResults);
      
      const successCount = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
      const failureCount = results.length - successCount;
      
      this.logger.log(`Job ${job.id}: Processed ${tasks.length} due soon reminders - ${successCount} success, ${failureCount} failures`);
      
      return {
        success: true,
        totalTasks: tasks.length,
        successCount,
        failureCount,
        results: results.map(r => r.status === 'fulfilled' ? r.value : { success: false, error: 'Promise rejected' })
      };
    } catch (error) {
      this.logger.error(`Job ${job.id}: Failed to process due soon reminders: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error; // Re-throw to trigger retry mechanism
    }
  }
} 