import { Module } from '@nestjs/common';
import { ProposalsService } from './proposals.service';
import { ProposalsController } from './proposals.controller';
import { ProposalTemplatesController } from './proposal-templates.controller';

@Module({
  providers: [ProposalsService],
  controllers: [ProposalsController, ProposalTemplatesController],
  exports: [ProposalsService],
})
export class ProposalsModule {}
