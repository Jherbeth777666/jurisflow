-- L11: regras por etapa. Um modelo de tarefa pode ser sugerido ao ENTRAR numa etapa do Kanban.
-- stage_id nulo = modelo de criação (comportamento do L9, inalterado). Nada é criado sem confirmação.
-- RLS, reorder_task_templates e kickoff_demand não mudam.

alter table public.task_templates add column stage_id uuid null;

-- A etapa precisa ser do mesmo escritório e da mesma categoria do modelo.
alter table public.task_templates
  add constraint task_templates_stage_org_fk
  foreign key (organization_id, stage_id) references public.workflow_stages (organization_id, id) on delete cascade;

alter table public.task_templates
  add constraint task_templates_stage_category_fk
  foreign key (category_id, stage_id) references public.workflow_stages (category_id, id) on delete cascade;

create index task_templates_stage_idx on public.task_templates (organization_id, stage_id);
