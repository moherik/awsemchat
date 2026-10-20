defmodule AwsemChat.Repo.Migrations.CreateReactions do
  use Ecto.Migration

  def change do
    create table(:reactions, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :target_type, :string, null: false
      add :target_id, :binary_id, null: false
      add :user_id, references(:users, type: :binary_id, on_delete: :delete_all), null: false
      add :emoji, :string, null: false

      add :created_at, :utc_datetime_usec, null: false
    end

    create index(:reactions, [:target_type, :target_id])
    create index(:reactions, [:user_id])
    create unique_index(:reactions, [:user_id, :target_type, :target_id])
  end
end
