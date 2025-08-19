import { Injectable, BadRequestException } from '@nestjs/common';
import { TaskStatus } from '../enums/task-status.enum';
import { TaskPriority } from '../enums/task-priority.enum';

export interface TaskValidationResult {
  isValid: boolean;
  errors: string[];
}

export interface TaskBusinessRules {
  canTransitionToStatus(currentStatus: TaskStatus, newStatus: TaskStatus): boolean;
  canAssignToUser(taskId: string, userId: string): boolean;
  validateDueDate(dueDate: Date): boolean;
  calculatePriorityScore(priority: TaskPriority, dueDate: Date): number;
}

@Injectable()
export class TaskDomainService implements TaskBusinessRules {
  
  /**
   * Validates if a task can transition to a new status
   */
  canTransitionToStatus(currentStatus: TaskStatus, newStatus: TaskStatus): boolean {
    const validTransitions: Record<TaskStatus, TaskStatus[]> = {
      [TaskStatus.PENDING]: [TaskStatus.IN_PROGRESS, TaskStatus.COMPLETED, TaskStatus.ARCHIVED],
      [TaskStatus.IN_PROGRESS]: [TaskStatus.COMPLETED, TaskStatus.ARCHIVED],
      [TaskStatus.COMPLETED]: [TaskStatus.ARCHIVED],
      [TaskStatus.ARCHIVED]: [], // No transitions from archived
    };

    return validTransitions[currentStatus]?.includes(newStatus) || false;
  }

  /**
   * Validates if a task can be assigned to a specific user
   */
  canAssignToUser(taskId: string, userId: string): boolean {
    // In a real application, you might check:
    // - User permissions
    // - User workload
    // - Task requirements vs user skills
    // - User availability
    
    // For now, we'll allow assignment to any valid user
    return Boolean(userId && userId.length > 0);
  }

  /**
   * Validates if a due date is reasonable
   */
  validateDueDate(dueDate: Date): boolean {
    const now = new Date();
    const minDate = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours from now
    const maxDate = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000); // 1 year from now

    return dueDate >= minDate && dueDate <= maxDate;
  }

  /**
   * Calculates a priority score based on priority and due date
   */
  calculatePriorityScore(priority: TaskPriority, dueDate: Date): number {
    const priorityWeights = {
      [TaskPriority.LOW]: 1,
      [TaskPriority.MEDIUM]: 2,
      [TaskPriority.HIGH]: 3,
    };

    const daysUntilDue = Math.ceil((dueDate.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
    
    // Higher score for higher priority and closer due dates
    let score = priorityWeights[priority] || 1;
    
    if (daysUntilDue <= 1) score += 5;
    else if (daysUntilDue <= 3) score += 3;
    else if (daysUntilDue <= 7) score += 1;
    
    return score;
  }

  /**
   * Validates task creation data
   */
  validateTaskCreation(data: {
    title: string;
    description: string;
    priority: string;
    dueDate?: Date;
  }): TaskValidationResult {
    const errors: string[] = [];

    if (!data.title || data.title.trim().length < 3) {
      errors.push('Title must be at least 3 characters long');
    }

    if (!data.description || data.description.trim().length < 10) {
      errors.push('Description must be at least 10 characters long');
    }

    if (!Object.values(TaskPriority).includes(data.priority as TaskPriority)) {
      errors.push('Invalid priority value');
    }

    if (data.dueDate && !this.validateDueDate(data.dueDate)) {
      errors.push('Due date must be between 24 hours and 1 year from now');
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Applies business rules to task updates
   */
  applyBusinessRules(task: any, updates: any): any {
    // Ensure business rules are followed
    if (updates.status && !this.canTransitionToStatus(task.status, updates.status)) {
      throw new BadRequestException(`Cannot transition from ${task.status} to ${updates.status}`);
    }

    if (updates.dueDate && !this.validateDueDate(updates.dueDate)) {
      throw new BadRequestException('Invalid due date');
    }

    return updates;
  }
}
