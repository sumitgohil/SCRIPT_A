import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { TasksService } from './tasks.service';
import { TasksController } from './tasks.controller';
import { Task } from './entities/task.entity';
import { AuthModule } from '../auth/auth.module';
import { TasksCqrsModule } from './tasks-cqrs.module';
import { TaskDomainService } from './domain/task-domain.service';
import { RolesGuard } from '../../common/guards/roles.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([Task]),
    BullModule.registerQueue({
      name: 'task-processing',
    }),
    forwardRef(() => AuthModule),
    TasksCqrsModule,
  ],
  controllers: [TasksController],
  providers: [TasksService, TaskDomainService, RolesGuard],
  exports: [TasksService, TypeOrmModule, TaskDomainService],
})
export class TasksModule {}
