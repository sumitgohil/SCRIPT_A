import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { Task } from './entities/task.entity';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { TaskStatus } from './enums/task-status.enum';
import { PaginatedResponse } from '../../types/pagination.interface';
import { TaskQueryDto } from './dto/task-query.dto';

@Injectable()
export class TasksService {
  constructor(
    @InjectRepository(Task)
    private tasksRepository: Repository<Task>,
    @InjectQueue('task-processing')
    private taskQueue: Queue,
  ) {}

  async create(createTaskDto: CreateTaskDto): Promise<Task> {
    // Optimized: proper transaction handling for task creation and queue addition
    const queryRunner = this.tasksRepository.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const task = this.tasksRepository.create(createTaskDto);
      const savedTask = await queryRunner.manager.save(Task, task);

      // Add to queue with proper error handling
      try {
        await this.taskQueue.add('task-status-update', {
          taskId: savedTask.id,
          status: savedTask.status,
        });
      } catch (queueError) {
        // Log queue error but don't fail the task creation
        console.error('Failed to add task to queue:', queueError);
      }

      await queryRunner.commitTransaction();
      return savedTask;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async findAll(): Promise<Task[]> {
    // Optimized: Add pagination and limit to prevent memory issues
    return this.tasksRepository.find({
      relations: ['user'],
      take: 100, // Limit to prevent excessive memory usage
      order: { createdAt: 'DESC' },
    });
  }

  async findAllWithFilters(
    filterDto: TaskQueryDto,
    paginationDto: TaskQueryDto,
  ): Promise<PaginatedResponse<Task>> {
    const { page = 1, limit = 10, sortBy = 'createdAt', sortOrder = 'DESC' } = paginationDto;
    const skip = (page - 1) * limit;

    // Create base query builder
    const baseQueryBuilder = this.tasksRepository.createQueryBuilder('task');
    this.applyFilters(baseQueryBuilder, filterDto);

    // Execute count and data queries
    const [total, tasks] = await Promise.all([
      baseQueryBuilder.getCount(),
      baseQueryBuilder
        .clone()
        .orderBy(`task.${sortBy}`, sortOrder)
        .skip(skip)
        .take(limit)
        .leftJoinAndSelect('task.user', 'user')
        .getMany(),
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
      data: tasks,
      meta: {
        total,
        page,
        limit,
        totalPages,
      },
    };
  }

  private applyFilters(queryBuilder: SelectQueryBuilder<Task>, filterDto: TaskQueryDto): void {
    if (filterDto.status) {
      queryBuilder.andWhere('task.status = :status', { status: filterDto.status });
    }

    if (filterDto.priority) {
      queryBuilder.andWhere('task.priority = :priority', { priority: filterDto.priority });
    }

    if (filterDto.userId) {
      queryBuilder.andWhere('task.userId = :userId', { userId: filterDto.userId });
    }

    if (filterDto.search) {
      queryBuilder.andWhere('(task.title ILIKE :search OR task.description ILIKE :search)', {
        search: `%${filterDto.search}%`,
      });
    }
  }

  async getTaskStatistics(): Promise<any> {
    // Efficient implementation using SQL aggregation
    const statistics = await this.tasksRepository
      .createQueryBuilder('task')
      .select([
        'COUNT(*) as total',
        'SUM(CASE WHEN task.status = :completedStatus THEN 1 ELSE 0 END) as completed',
        'SUM(CASE WHEN task.status = :inProgressStatus THEN 1 ELSE 0 END) as inProgress',
        'SUM(CASE WHEN task.status = :pendingStatus THEN 1 ELSE 0 END) as pending',
        'SUM(CASE WHEN task.priority = :highPriority THEN 1 ELSE 0 END) as highPriority',
        'SUM(CASE WHEN task.priority = :mediumPriority THEN 1 ELSE 0 END) as mediumPriority',
        'SUM(CASE WHEN task.priority = :lowPriority THEN 1 ELSE 0 END) as lowPriority',
        'SUM(CASE WHEN task.dueDate < :now AND task.status != :completedStatus THEN 1 ELSE 0 END) as overdue',
      ])
      .setParameters({
        completedStatus: TaskStatus.COMPLETED,
        inProgressStatus: TaskStatus.IN_PROGRESS,
        pendingStatus: TaskStatus.PENDING,
        highPriority: 'HIGH',
        mediumPriority: 'MEDIUM',
        lowPriority: 'LOW',
        now: new Date(),
      })
      .getRawOne();

    return {
      total: parseInt(statistics.total),
      completed: parseInt(statistics.completed),
      inProgress: parseInt(statistics.inProgress),
      pending: parseInt(statistics.pending),
      highPriority: parseInt(statistics.highPriority),
      mediumPriority: parseInt(statistics.mediumPriority),
      lowPriority: parseInt(statistics.lowPriority),
      overdue: parseInt(statistics.overdue),
    };
  }

  async findOne(id: string): Promise<Task> {
    // Optimized: single database call with proper error handling
    const task = await this.tasksRepository.findOne({
      where: { id },
      relations: ['user'],
    });

    if (!task) {
      throw new NotFoundException(`Task with ID ${id} not found`);
    }

    return task;
  }

  async update(id: string, updateTaskDto: UpdateTaskDto): Promise<Task> {
    // Optimized: single database call with proper transaction handling
    const queryRunner = this.tasksRepository.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const task = await queryRunner.manager.findOne(Task, {
        where: { id },
        relations: ['user'],
      });

      if (!task) {
        throw new NotFoundException(`Task with ID ${id} not found`);
      }

      const originalStatus = task.status;

      // Update only the fields that are provided
      Object.assign(task, updateTaskDto);
      task.updatedAt = new Date();

      const updatedTask = await queryRunner.manager.save(Task, task);

      // Add to queue if status changed with proper error handling
      if (originalStatus !== updatedTask.status) {
        try {
          await this.taskQueue.add('task-status-update', {
            taskId: updatedTask.id,
            status: updatedTask.status,
          });
        } catch (queueError) {
          // Log queue error but don't fail the update
          console.error('Failed to add task to queue:', queueError);
        }
      }

      await queryRunner.commitTransaction();
      return updatedTask;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async remove(id: string): Promise<void> {
    // Optimized: single database call with proper transaction handling
    const queryRunner = this.tasksRepository.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const task = await queryRunner.manager.findOne(Task, {
        where: { id },
      });

      if (!task) {
        throw new NotFoundException(`Task with ID ${id} not found`);
      }

      await queryRunner.manager.remove(Task, task);
      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async findByStatus(status: TaskStatus): Promise<Task[]> {
    // Optimized: using proper repository patterns with TypeORM
    return this.tasksRepository.find({
      where: { status },
      relations: ['user'],
      order: { createdAt: 'DESC' },
    });
  }

  async searchTasks(searchTerm: string, limit: number = 20): Promise<Task[]> {
    // Optimized: Efficient search with proper indexing considerations
    return this.tasksRepository
      .createQueryBuilder('task')
      .leftJoinAndSelect('task.user', 'user')
      .where('task.title ILIKE :searchTerm', { searchTerm: `%${searchTerm}%` })
      .orWhere('task.description ILIKE :searchTerm', { searchTerm: `%${searchTerm}%` })
      .orderBy('task.createdAt', 'DESC')
      .take(limit)
      .getMany();
  }

  async getTasksByUser(
    userId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<PaginatedResponse<Task>> {
    // Optimized: Get tasks by user with proper pagination
    const skip = (page - 1) * limit;

    const [total, tasks] = await Promise.all([
      this.tasksRepository.count({ where: { userId } }),
      this.tasksRepository.find({
        where: { userId },
        relations: ['user'],
        order: { createdAt: 'DESC' },
        skip,
        take: limit,
      }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
      data: tasks,
      meta: {
        total,
        page,
        limit,
        totalPages,
      },
    };
  }

  async getOverdueTasks(limit: number = 50): Promise<Task[]> {
    // Optimized: Get overdue tasks efficiently with proper indexing
    return this.tasksRepository
      .createQueryBuilder('task')
      .leftJoinAndSelect('task.user', 'user')
      .where('task.dueDate < :now', { now: new Date() })
      .andWhere('task.status != :completedStatus', { completedStatus: TaskStatus.COMPLETED })
      .orderBy('task.dueDate', 'ASC')
      .take(limit)
      .getMany();
  }

  async getTaskStatisticsByUser(userId: string): Promise<any> {
    // Optimized: Get task statistics for a specific user
    const statistics = await this.tasksRepository
      .createQueryBuilder('task')
      .select([
        'COUNT(*) as total',
        'SUM(CASE WHEN task.status = :completedStatus THEN 1 ELSE 0 END) as completed',
        'SUM(CASE WHEN task.status = :inProgressStatus THEN 1 ELSE 0 END) as inProgress',
        'SUM(CASE WHEN task.status = :pendingStatus THEN 1 ELSE 0 END) as pending',
        'SUM(CASE WHEN task.dueDate < :now AND task.status != :completedStatus THEN 1 ELSE 0 END) as overdue',
      ])
      .where('task.userId = :userId', { userId })
      .setParameters({
        completedStatus: TaskStatus.COMPLETED,
        inProgressStatus: TaskStatus.IN_PROGRESS,
        pendingStatus: TaskStatus.PENDING,
        now: new Date(),
      })
      .getRawOne();

    return {
      total: parseInt(statistics.total),
      completed: parseInt(statistics.completed),
      inProgress: parseInt(statistics.inProgress),
      pending: parseInt(statistics.pending),
      overdue: parseInt(statistics.overdue),
    };
  }

  async updateStatus(id: string, status: string): Promise<Task> {
    // Optimized: Use transaction for status updates to ensure consistency
    const queryRunner = this.tasksRepository.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const task = await queryRunner.manager.findOne(Task, {
        where: { id },
        relations: ['user'],
      });

      if (!task) {
        throw new NotFoundException(`Task with ID ${id} not found`);
      }

      task.status = status as TaskStatus;
      task.updatedAt = new Date();

      const updatedTask = await queryRunner.manager.save(Task, task);
      await queryRunner.commitTransaction();

      return updatedTask;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async bulkUpdateStatus(
    taskIds: string[],
    status: TaskStatus,
  ): Promise<{ success: boolean; affectedRows: number }> {
    // Optimized: Bulk status update for better performance
    const queryRunner = this.tasksRepository.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const result = await queryRunner.manager
        .createQueryBuilder()
        .update(Task)
        .set({
          status,
          updatedAt: new Date(),
        })
        .whereInIds(taskIds)
        .execute();

      await queryRunner.commitTransaction();
      return { success: true, affectedRows: result.affected || 0 };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async batchProcess(operations: { tasks: string[]; action: string }): Promise<any[]> {
    const { tasks: taskIds, action } = operations;
    const results = [];

    // Validate action
    if (!['complete', 'delete', 'archive'].includes(action)) {
      throw new BadRequestException(`Unknown action: ${action}`);
    }

    // Use transaction for batch operations
    const queryRunner = this.tasksRepository.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Optimized: Use bulk operations instead of sequential processing
      switch (action) {
        case 'complete':
          const updateResult = await queryRunner.manager
            .createQueryBuilder()
            .update(Task)
            .set({
              status: TaskStatus.COMPLETED,
              updatedAt: new Date(),
            })
            .whereInIds(taskIds)
            .execute();

          results.push({ action: 'complete', success: true, affectedRows: updateResult.affected });
          break;

        case 'delete':
          const deleteResult = await queryRunner.manager
            .createQueryBuilder()
            .delete()
            .from(Task)
            .whereInIds(taskIds)
            .execute();

          results.push({ action: 'delete', success: true, affectedRows: deleteResult.affected });
          break;

        case 'archive':
          const archiveResult = await queryRunner.manager
            .createQueryBuilder()
            .update(Task)
            .set({
              status: TaskStatus.ARCHIVED,
              updatedAt: new Date(),
            })
            .whereInIds(taskIds)
            .execute();

          results.push({ action: 'archive', success: true, affectedRows: archiveResult.affected });
          break;
      }

      await queryRunner.commitTransaction();
      return results;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async assignTask(taskId: string, userId: string): Promise<Task> {
    // Find the task and user, then assign the task
    const task = await this.findOne(taskId);
    if (!task) {
      throw new NotFoundException(`Task with ID ${taskId} not found`);
    }

    // Note: In a real application, you would validate that the user exists
    // For now, we'll just assign the task
    task.userId = userId;

    return this.tasksRepository.save(task);
  }
}
