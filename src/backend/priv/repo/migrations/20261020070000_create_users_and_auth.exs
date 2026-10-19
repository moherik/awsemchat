defmodule AwsemChat.Repo.Migrations.CreateUsersAndAuth do
  use Ecto.Migration

  def change do
    create table(:users, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :phone, :string, null: false
      add :display_name, :string
      # No DB foreign key: the media table does not exist yet (Task 3). Recorded
      # design decision — an application-level check replaces it for now.
      add :avatar_media_id, :binary_id
      add :status_text, :string
      add :pin, :string, null: false
      add :now_playing, :string

      timestamps(type: :utc_datetime)
    end

    create unique_index(:users, [:phone])
    create unique_index(:users, [:pin])

    create table(:auth_tokens, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :user_id, references(:users, type: :binary_id, on_delete: :delete_all), null: false
      add :token_hash, :string, null: false
      add :revoked_at, :utc_datetime
      add :last_used_at, :utc_datetime

      timestamps(type: :utc_datetime)
    end

    create unique_index(:auth_tokens, [:token_hash])
    create index(:auth_tokens, [:user_id])
  end
end
