"""Gera os SQLs para colar no SQL Editor do Supabase (projeto na nuvem).

- supabase/deploy/BANCO-COMPLETO.sql: todas as migrations, para um banco novo.
- supabase/deploy/ATUALIZAR-BANCO.sql: só as migrations depois da 20261109000009,
  para quem já rodou a versão antiga do BANCO-COMPLETO.sql.

Uso: python scripts/gerar-sql-unico.py
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MIG = ROOT / "supabase" / "migrations"
OUT = ROOT / "supabase" / "deploy"
BASE = "20261109000009"  # última migration do BANCO-COMPLETO.sql antigo

PERFIS = """-- >>>>>>>>>> perfis de usuários que se cadastraram ANTES da criação do banco
insert into public.profiles (id, full_name, email)
select id, coalesce(raw_user_meta_data->>'full_name', ''), email from auth.users
on conflict (id) do nothing;
"""


def bloco(files):
    partes = []
    for f in files:
        texto = f.read_text(encoding="utf-8").lstrip("﻿").rstrip() + "\n"
        partes.append(f"-- >>>>>>>>>> {f.name}\n{texto}\n")
    return "".join(partes)


def registro(files):
    linhas = ",\n".join(f"  ('{f.name[:14]}', '{f.stem[15:]}')" for f in files)
    return (
        "-- >>>>>>>>>> registro das migrations (para a CLI do Supabase reconhecer)\n"
        "create schema if not exists supabase_migrations;\n"
        "create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text);\n"
        f"insert into supabase_migrations.schema_migrations (version, name) values\n{linhas}\n"
        "on conflict do nothing;\n\n"
    )


def main():
    todas = sorted(MIG.glob("*.sql"))
    novas = [f for f in todas if f.name[:14] > BASE]

    completo = (
        f"-- JurisFlow AI — estrutura completa do banco ({len(todas)} migrations em ordem).\n"
        "-- Banco NOVO: cole TUDO no Supabase > SQL Editor > New query e clique em Run. Rodar uma única vez.\n"
        "-- Banco que já rodou a versão antiga deste arquivo: use ATUALIZAR-BANCO.sql.\n"
        "-- Gerado por scripts/gerar-sql-unico.py — não editar à mão.\n\n"
        + bloco(todas) + registro(todas) + PERFIS
    )
    atualizar = (
        f"-- JurisFlow AI — atualização do banco ({len(novas)} migrations novas, depois da {BASE}).\n"
        "-- Para quem JÁ rodou o BANCO-COMPLETO.sql antigo (migrations 001 a 009).\n"
        "-- Cole TUDO no Supabase > SQL Editor > New query e clique em Run. Rodar uma única vez.\n"
        "-- Gerado por scripts/gerar-sql-unico.py — não editar à mão.\n\n"
        "-- Trava: para aqui se o banco não estiver na versão esperada (ou se esta atualização já rodou).\n"
        "do $$\nbegin\n"
        "  if to_regclass('public.organizations') is null then\n"
        "    raise exception 'Banco vazio: rode o BANCO-COMPLETO.sql em vez deste arquivo.';\n"
        "  end if;\n"
        f"  if exists (select 1 from supabase_migrations.schema_migrations where version = '{novas[0].name[:14]}') then\n"
        "    raise exception 'Esta atualização já foi aplicada.';\n"
        "  end if;\n"
        "end $$;\n\n"
        + bloco(novas) + registro(novas)
    )
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "BANCO-COMPLETO.sql").write_text(completo, encoding="utf-8", newline="\n")
    (OUT / "ATUALIZAR-BANCO.sql").write_text(atualizar, encoding="utf-8", newline="\n")
    print(f"BANCO-COMPLETO.sql: {len(todas)} migrations; ATUALIZAR-BANCO.sql: {len(novas)} migrations")


if __name__ == "__main__":
    main()
