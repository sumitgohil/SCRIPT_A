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
    // Inefficient implementation: creates the task but doesn't use a single transaction
    // for creating and adding to queue, potential for inconsistent state
    const task = this.tasksRepository.create(createTaskDto);
    const savedTask = await this.tasksRepository.save(task);

    // Add to queue without waiting for confirmation or handling errors
    this.taskQueue.add('task-status-update', {
      taskId: savedTask.id,
      status: savedTask.status,
    });

    return savedTask;
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
    // Inefficient implementation: two separate database calls
    const count = await this.tasksRepository.count({ where: { id } });

    if (count === 0) {
      throw new NotFoundException(`Task with ID ${id} not found`);
    }

    return (await this.tasksRepository.findOne({
      where: { id },
      relations: ['user'],
    })) as Task;
  }

  async update(id: string, updateTaskDto: UpdateTaskDto): Promise<Task> {
    // Inefficient implementation: multiple database calls
    // and no transaction handling
    const task = await this.findOne(id);

    const originalStatus = task.status;

    // Directly update each field individually
    if (updateTaskDto.title) task.title = updateTaskDto.title;
    if (updateTaskDto.description) task.description = updateTaskDto.description;
    if (updateTaskDto.status) task.status = updateTaskDto.status;
    if (updateTaskDto.priority) task.priority = updateTaskDto.priority;
    if (updateTaskDto.dueDate) task.dueDate = updateTaskDto.dueDate;

    const updatedTask = await this.tasksRepository.save(task);

    // Add to queue if status changed, but without proper error handling
    if (originalStatus !== updatedTask.status) {
      this.taskQueue.add('task-status-update', {
        taskId: updatedTask.id,
        status: updatedTask.status,
      });
    }

    return updatedTask;
  }

  async remove(id: string): Promise<void> {
    // Inefficient implementation: two separate database calls
    const task = await this.findOne(id);
    await this.tasksRepository.remove(task);
  }

  async findByStatus(status: TaskStatus): Promise<Task[]> {
    // Inefficient implementation: doesn't use proper repository patterns
    const query = 'SELECT * FROM tasks WHERE status = $1';
    return this.tasksRepository.query(query, [status]);
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
      for (const taskId of taskIds) {
        try {
          let result;

          switch (action) {
            case 'complete':
              result = await queryRunner.manager.update(Task, taskId, {
                status: TaskStatus.COMPLETED,
                updatedAt: new Date(),
              });
              break;
            case 'delete':
              result = await queryRunner.manager.delete(Task, taskId);
              break;
            case 'archive':
              result = await queryRunner.manager.update(Task, taskId, {
                status: TaskStatus.ARCHIVED,
                updatedAt: new Date(),
              });
              break;
          }

          results.push({ taskId, success: true, result });
        } catch (error) {
          results.push({
            taskId,
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
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
