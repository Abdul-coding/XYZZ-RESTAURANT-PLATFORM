import { Module } from '@nestjs/common';
import { RestaurantController } from './restaurant.controller';
import { RestaurantService } from './restaurant.service';
import { AuditLogService } from './audit-log.service';
import { EVENT_PUBLISHER, EVENT_STREAM_PROVIDER } from './event-publisher';
import { InMemoryEventPublisher } from './in-memory-event-publisher';
import { WaiterAssignmentService } from './waiter-assignment.service';
import { CustomerService } from './customer.service';
import { CheckoutService } from './checkout.service';
import { SessionExpiryService } from './session-expiry.service';
import { AdminDashboardController } from './admin-dashboard.controller';
import { AdminDashboardService } from './admin-dashboard.service';

@Module({
  controllers: [RestaurantController, AdminDashboardController],
  providers: [
    RestaurantService,
    CustomerService,
    CheckoutService,
    SessionExpiryService,
    AdminDashboardService,
    AuditLogService,
    WaiterAssignmentService,
    InMemoryEventPublisher,
    { provide: EVENT_PUBLISHER, useExisting: InMemoryEventPublisher },
    { provide: EVENT_STREAM_PROVIDER, useExisting: InMemoryEventPublisher },
  ],
})
export class RestaurantModule {}
