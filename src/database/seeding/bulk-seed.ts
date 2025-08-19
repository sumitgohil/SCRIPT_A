import { DataSource } from 'typeorm';
import { User } from '../../modules/users/entities/user.entity';
import { Task } from '../../modules/tasks/entities/task.entity';
import { UserRole } from '../../modules/users/enums/user-role.enum';
import { TaskStatus } from '../../modules/tasks/enums/task-status.enum';
import { TaskPriority } from '../../modules/tasks/enums/task-priority.enum';
import * as bcrypt from 'bcrypt';

export async function bulkSeed(database: DataSource) {
  console.log('🌱 Starting bulk seeding...');

  // Create bulk users
  const users = await createBulkUsers(database);
  console.log(`✅ Created ${users.length} users`);

  // Create bulk tasks
  const tasks = await createBulkTasks(database, users);
  console.log(`✅ Created ${tasks.length} tasks`);

  console.log('🎉 Bulk seeding completed successfully!');
  return { users, tasks };
}

async function createBulkUsers(database: DataSource): Promise<User[]> {
  const userRepository = database.getRepository(User);
  const users: User[] = [];

  // Create 50 users with different roles
  for (let i = 1; i <= 50; i++) {
    const role = i <= 5 ? UserRole.ADMIN : UserRole.USER;
    const user = userRepository.create({
      email: `user${i}@example.com`,
      password: await bcrypt.hash('password123', 10),
      name: `User ${i}`,
      role,
    });
    users.push(user);
  }

  // Create some users with specific patterns for testing
  const specialUsers = [
    { email: 'manager@example.com', name: 'Project Manager', role: UserRole.ADMIN },
    { email: 'developer@example.com', name: 'Senior Developer', role: UserRole.USER },
    { email: 'tester@example.com', name: 'QA Tester', role: UserRole.USER },
    { email: 'designer@example.com', name: 'UI Designer', role: UserRole.USER },
    { email: 'analyst@example.com', name: 'Business Analyst', role: UserRole.USER },
  ];

  for (const specialUser of specialUsers) {
    const user = userRepository.create({
      ...specialUser,
      password: await bcrypt.hash('password123', 10),
    });
    users.push(user);
  }

  return await userRepository.save(users);
}

async function createBulkTasks(database: DataSource, users: User[]): Promise<Task[]> {
  const taskRepository = database.getRepository(Task);
  const tasks: Task[] = [];

  const taskTemplates = [
    { title: 'Code Review', description: 'Review pull request for feature implementation' },
    { title: 'Bug Fix', description: 'Fix critical bug in production system' },
    { title: 'Feature Development', description: 'Implement new feature based on requirements' },
    { title: 'Testing', description: 'Perform comprehensive testing of new features' },
    { title: 'Documentation', description: 'Update API documentation and user guides' },
    {
      title: 'Performance Optimization',
      description: 'Optimize database queries and API responses',
    },
    { title: 'Security Audit', description: 'Conduct security review of authentication system' },
    { title: 'Deployment', description: 'Deploy application to staging environment' },
    { title: 'Monitoring Setup', description: 'Configure application monitoring and alerting' },
    { title: 'Backup Verification', description: 'Verify database backup and recovery procedures' },
    { title: 'Load Testing', description: 'Perform load testing on critical endpoints' },
    { title: 'Code Refactoring', description: 'Refactor legacy code for better maintainability' },
    {
      title: 'Dependency Update',
      description: 'Update third-party dependencies to latest versions',
    },
    {
      title: 'Error Handling',
      description: 'Improve error handling and logging throughout the application',
    },
    { title: 'API Design', description: 'Design new REST API endpoints for mobile application' },
  ];

  const priorities = [TaskPriority.LOW, TaskPriority.MEDIUM, TaskPriority.HIGH];
  const statuses = [
    TaskStatus.PENDING,
    TaskStatus.IN_PROGRESS,
    TaskStatus.COMPLETED,
    TaskStatus.ARCHIVED,
  ];

  // Create 500 tasks with varied data
  for (let i = 1; i <= 500; i++) {
    const template = taskTemplates[i % taskTemplates.length];
    const priority = priorities[i % priorities.length];
    const status = statuses[i % statuses.length];
    const user = users[i % users.length];

    // Create varied due dates (some past, some future, some null)
    let dueDate: Date | undefined = undefined;
    if (i % 3 === 0) {
      dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + (i % 30) - 15); // -15 to +15 days
    }

    const task = taskRepository.create({
      title: `${template.title} #${i}`,
      description: `${template.description} - Task ${i}`,
      priority,
      status,
      dueDate,
      userId: user.id,
    });

    tasks.push(task);
  }

  // Create some specific tasks for testing different scenarios
  const specificTasks = [
    {
      title: 'Critical Production Issue',
      description: 'Fix authentication failure affecting all users',
      priority: TaskPriority.HIGH,
      status: TaskStatus.IN_PROGRESS,
      dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000), // Due tomorrow
      userId: users[0].id, // Admin user
    },
    {
      title: 'Long-term Research Project',
      description: 'Research and evaluate new database technologies',
      priority: TaskPriority.LOW,
      status: TaskStatus.PENDING,
      dueDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // Due in 90 days
      userId: users[1].id,
    },
    {
      title: 'Immediate Hotfix',
      description: 'Fix security vulnerability in user authentication',
      priority: TaskPriority.HIGH,
      status: TaskStatus.PENDING,
      dueDate: new Date(Date.now() + 2 * 60 * 60 * 1000), // Due in 2 hours
      userId: users[0].id,
    },
  ];

  for (const specificTask of specificTasks) {
    const task = taskRepository.create(specificTask);
    tasks.push(task);
  }

  return await taskRepository.save(tasks);
}

// Export for use in other scripts
export { createBulkUsers, createBulkTasks };
