import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { AuthService } from '../../modules/auth/auth.service';
import { UserRole } from '../../modules/users/enums/user-role.enum';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private authService: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    
    if (!requiredRoles) {
      return true;
    }
    
    const { user } = context.switchToHttp().getRequest();
    
    if (!user) {
      throw new ForbiddenException('User not authenticated');
    }
    
    // Convert string roles to UserRole enum
    const userRoles = requiredRoles.map(role => role as UserRole);
    
    // Use the improved role validation from AuthService
    const hasRequiredRole = await this.authService.validateUserRoles(user.id, userRoles);
    
    if (!hasRequiredRole) {
      throw new ForbiddenException(
        `User does not have required roles. Required: ${requiredRoles.join(', ')}`
      );
    }
    
    return true;
  }
} 