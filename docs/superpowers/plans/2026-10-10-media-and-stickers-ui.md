# Chat media and stickers UI

Authorized: production-intended UI backed by demo state, preserving AwsemChat's private chats/Circles and in-app-only sticker creation.

- Replace inline attachment rows with native bottom sheets: gallery/camera preview, caption and send; stickers; GIF entry; private PING; shared media.
- Visual sticker artwork shared by picker, library, editor preview and messages. Personal/Circle tabs, pack/search filtering, preview/send/save, recent items.
- Dedicated library: pack list, sticker details/rename/remove, Circle sharing and admin removal. Removing a personal copy must not erase shared copies or already sent messages.
- Dedicated maker: choose photo or sample, actual image crop, text placement/size/color, honest sample-only background removal, composition preview, unique identity and save-to-pack.
- Verify library identity/immutable sent compositions and end-to-end browser journeys; typecheck/lint/web and Android bundle exports. Native device/provider limitations remain explicit.
