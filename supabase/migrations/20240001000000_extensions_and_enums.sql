-- Migration 1: Extensions and enums
-- 20240001000000_extensions_and_enums.sql

create extension if not exists "pgcrypto";
create extension if not exists "vector" schema extensions;

create type user_role as enum ('admin', 'consultant', 'site_manager', 'foreman');
create type task_state as enum ('assigned', 'in_progress', 'completed', 'missed', 'cancelled');
create type sensitivity as enum ('normal', 'restricted');
create type qa_status as enum ('open', 'answered', 'escalated', 'closed');
create type visibility_scope as enum ('tier', 'subtree', 'organization');
create type content_type as enum ('journal_entry', 'wiki_entry_version', 'qa_answer_version', 'qa_question');
create type ai_function as enum ('supervisor_summary', 'cross_team_query', 'synthesis_prep', 'clone_agent');