# Populates the dev database with the demo cast: the bot accounts the owner can
# add as friends and talk to. Safe to run repeatedly.
#
#     mix run priv/repo/seeds.exs
#
# `mix ecto.setup` runs this as part of setting up the database.
#
# Run `mix awsemchat.seed` instead to seed and print the bot phones and PINs.

AwsemChat.Seeds.seed()
