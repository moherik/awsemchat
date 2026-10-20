# Populates the database with the demo cast when setting up: the bot accounts
# the owner can add as friends and talk to. Safe to run repeatedly.
#
#     mix run priv/repo/seeds.exs
#
# `mix ecto.setup` runs this. `priv/repo/seed.exs` is the same seed under the
# name the task brief uses. Run `mix awsemchat.seed` to seed and print the bot
# phones and PINs.

AwsemChat.Seeds.seed()
