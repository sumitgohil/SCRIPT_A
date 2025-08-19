export class CreateTaskCommand {
  constructor(
    public readonly title: string,
    public readonly description: string,
    public readonly priority: string,
    public readonly userId: string,
    public readonly dueDate?: Date,
  ) {}
}
