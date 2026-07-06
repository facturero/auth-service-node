import { UserRepository } from '../../domain/repositories';

export interface UserSummaryItem {
  id: string;
  email: string;
  fullName: string | null;
  status: string;
}

export class ListUsersUseCase {
  constructor(private readonly users: UserRepository) {}

  async execute(organizationId: string): Promise<UserSummaryItem[]> {
    const users = await this.users.listByOrganization(organizationId);
    return users.map((u) => ({
      id: u.id,
      email: u.email,
      fullName: u.fullName,
      status: u.status,
    }));
  }
}
