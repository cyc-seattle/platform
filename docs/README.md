# CYC platform docs

How CYC's shared Google Cloud platform is built and run, for anyone who works on it. The
[README](../README.md) lists the stacks and how to set up a checkout.

## Platform

- [Architecture](architecture.md): where things run, and why
- [The backend stack](backend.md): Directus, its schema, and what deploys it
- [Who can do what](access.md): roles, policies, and the query guard
- [The syncs](syncs.md): clubspot-sync and gsuite-sync
- [Backups and restores](backups.md): what's copied, the restore drill, and a real restore
- [The public website's content](website.md)
- [Manual setup steps](manual-setup.md): what Pulumi can't do

## Data model

- [CRM: schema and permission model](crm-schema.md)
- [Crew: schema](crew-schema.md): volunteers and staff, their positions, terms, pay, and qualifications
- [HR: schema](hr-schema.md): staff roles and levels
- [Planning: schema](planning-schema.md)
- [Planning: engine](planning-engine.md): how a plan's numbers are calculated

## Reference

- [Google Groups: how nested groups behave](google-groups-nesting.md)
