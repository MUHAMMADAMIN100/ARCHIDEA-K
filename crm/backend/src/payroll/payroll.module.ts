import { Module } from '@nestjs/common';
import { PayrollService } from './payroll.service';
import { PayrollController } from './payroll.controller';
import { ShiftGroupsService } from './shift-groups.service';
import { ShiftGroupsController } from './shift-groups.controller';

@Module({
  providers: [PayrollService, ShiftGroupsService],
  controllers: [PayrollController, ShiftGroupsController],
  exports: [PayrollService, ShiftGroupsService],
})
export class PayrollModule {}
