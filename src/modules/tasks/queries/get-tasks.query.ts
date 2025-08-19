export class GetTasksQuery {
  constructor(
    public readonly page: number = 1,
    public readonly limit: number = 10,
    public readonly status?: string,
    public readonly priority?: string,
    public readonly userId?: string,
    public readonly search?: string,
  ) {}
}
