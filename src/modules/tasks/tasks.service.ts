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
    // Inefficient implementation: retrieves all tasks without pagination
    // and loads all relations, causing potential performance issues
    return this.tasksRepository.find({
      relations: ['user'],
    });
  }

  async findAllWithFilters(
    filterDto: TaskQueryDto,
    paginationDto: TaskQueryDto,
  ): Promise<PaginatedResponse<Task>> {
    const queryBuilder = this.tasksRepository.createQueryBuilder('task');

    // Apply filters
    this.applyFilters(queryBuilder, filterDto);

    // Apply pagination
    const { page = 1, limit = 10, sortBy = 'createdAt', sortOrder = 'DESC' } = paginationDto;
    const skip = (page - 1) * limit;

    // Apply sorting
    queryBuilder.orderBy(`task.${sortBy}`, sortOrder);

    // Apply pagination
    queryBuilder.skip(skip).take(limit);

    // Include user relation if requested
    if (paginationDto.includeUser !== false) {
      queryBuilder.leftJoinAndSelect('task.user', 'user');
    }

    // Get total count for pagination
    const totalQueryBuilder = this.tasksRepository.createQueryBuilder('task');
    this.applyFilters(totalQueryBuilder, filterDto);
    const total = await totalQueryBuilder.getCount();

    // Execute query
    const tasks = await queryBuilder.getMany();

    // Calculate pagination metadata
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

    if (filterDto.statuses && filterDto.statuses.length > 0) {
      queryBuilder.andWhere('task.status IN (:...statuses)', { statuses: filterDto.statuses });
    }

    if (filterDto.priorities && filterDto.priorities.length > 0) {
      queryBuilder.andWhere('task.priority IN (:...priorities)', {
        priorities: filterDto.priorities,
      });
    }

    if (filterDto.userIds && filterDto.userIds.length > 0) {
      queryBuilder.andWhere('task.userId IN (:...userIds)', { userIds: filterDto.userIds });
    }

    // Special date filters
    if (filterDto.overdue) {
      queryBuilder.andWhere('task.dueDate < :now AND task.status != :completedStatus', {
        now: new Date(),
        completedStatus: TaskStatus.COMPLETED,
      });
    }

    if (filterDto.dueToday) {
      const today = new Date();
      const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const endOfDay = new Date(
        today.getFullYear(),
        today.getMonth(),
        today.getDate(),
        23,
        59,
        59,
        999,
      );
      queryBuilder.andWhere('task.dueDate BETWEEN :startOfDay AND :endOfDay', {
        startOfDay,
        endOfDay,
      });
    }

    if (filterDto.dueThisWeek) {
      const today = new Date();
      const startOfWeek = new Date(today);
      startOfWeek.setDate(today.getDate() - today.getDay());
      startOfWeek.setHours(0, 0, 0, 0);
      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(startOfWeek.getDate() + 6);
      endOfWeek.setHours(23, 59, 59, 999);
      queryBuilder.andWhere('task.dueDate BETWEEN :startOfWeek AND :endOfWeek', {
        startOfWeek,
        endOfWeek,
      });
    }

    if (filterDto.dueThisMonth) {
      const today = new Date();
      const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59, 999);
      queryBuilder.andWhere('task.dueDate BETWEEN :startOfMonth AND :endOfMonth', {
        startOfMonth,
        endOfMonth,
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

  async updateStatus(id: string, status: string): Promise<Task> {
    // This method will be called by the task processor
    const task = await this.findOne(id);
    task.status = status as any;
    return this.tasksRepository.save(task);
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
}
