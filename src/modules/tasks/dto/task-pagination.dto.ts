import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsInt, Min, Max, IsEnum, IsString } from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { PaginationOptions } from '../../../types/pagination.interface';

export class TaskPaginationDto implements PaginationOptions {
  @ApiPropertyOptional({
    description: 'Page number for pagination (starts from 1)',
    example: 1,
    minimum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    description: 'Number of items per page',
    example: 10,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 10;

  @ApiPropertyOptional({
    description: 'Field to sort by',
    example: 'createdAt',
    enum: ['id', 'title', 'status', 'priority', 'dueDate', 'createdAt', 'updatedAt'],
  })
  @IsOptional()
  @IsString()
  @IsEnum(['id', 'title', 'status', 'priority', 'dueDate', 'createdAt', 'updatedAt'])
  sortBy?: string = 'createdAt';

  @ApiPropertyOptional({
    description: 'Sort order (ascending or descending)',
    example: 'DESC',
    enum: ['ASC', 'DESC'],
  })
  @IsOptional()
  @IsEnum(['ASC', 'DESC'])
  sortOrder?: 'ASC' | 'DESC' = 'DESC';

  @ApiPropertyOptional({
    description: 'Include user information in the response',
    example: true,
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  includeUser?: boolean = true;

  @ApiPropertyOptional({
    description: 'Include task statistics in the response',
    example: false,
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  includeStats?: boolean = false;
}
