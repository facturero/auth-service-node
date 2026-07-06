import { PermissionRepository } from '../../domain/repositories';

export interface PermissionItem {
  id: string;
  code: string;
  resource: string;
  action: string;
  description: string | null;
}

export class ListPermissionsUseCase {
  constructor(private readonly permissions: PermissionRepository) {}

  async execute(): Promise<PermissionItem[]> {
    const perms = await this.permissions.findAll();
    return perms.map((p) => ({
      id: p.id,
      code: p.code,
      resource: p.resource,
      action: p.action,
      description: p.description,
    }));
  }
}
