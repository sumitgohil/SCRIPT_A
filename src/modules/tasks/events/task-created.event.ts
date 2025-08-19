export class TaskCreatedEvent {
  constructor(
    public readonly taskId: string,
    public readonly title: string,
    public readonly userId: string,
    public readonly timestamp: Date = new Date(),
  ) {}
}
