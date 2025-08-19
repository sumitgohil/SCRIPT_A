import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { GetTasksQuery } from '../get-tasks.query';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { Task } from '../../entities/task.entity';
import { PaginatedResponse } from '../../../../types/pagination.interface';

@QueryHandler(GetTasksQuery)
export class GetTasksHandler implements IQueryHandler<GetTasksQuery> {
  constructor(
    @InjectRepository(Task)
    private readonly taskRepository: Repository<Task>,
  ) {}

  async execute(query: GetTasksQuery): Promise<PaginatedResponse<Task>> {
    const { page, limit, status, priority, userId, search } = query;
    const skip = (page - 1) * limit;

    // Build the query
    const queryBuilder = this.taskRepository.createQueryBuilder('task');
    
    // Apply filters
    if (status) {
      queryBuilder.andWhere('task.status = :status', { status });
    }
    
    if (priority) {
      queryBuilder.andWhere('task.priority = :priority', { priority });
    }
    
    if (userId) {
      queryBuilder.andWhere('task.userId = :userId', { userId });
    }
    
    if (search) {
      queryBuilder.andWhere(
        '(task.title ILIKE :search OR task.description ILIKE :search)',
        { search: `%${search}%` },
      );
    }

    // Execute count and data queries in parallel
    const [total, tasks] = await Promise.all([
      queryBuilder.getCount(),
      queryBuilder
        .leftJoinAndSelect('task.user', 'user')
        .orderBy('task.createdAt', 'DESC')
        .skip(skip)
        .take(limit)
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
}
