# E-Property Mobile — хөгжүүлэлтийн prompt

Огноо: 2026-10-03. Төлөв: шийдвэр + агентад өгөх prompt.

## 1. Шийдвэр: native хүрээ + web ажлын муж

Бүрэн native эсвэл бүрэн web биш, **native бүрхүүл + web ажлын муж** хэлбэрийг сонгосон. Энэ нь Gerege Nexus цөмд аль хэдийн байгаа загвар ([Bridge Contract v1.4](../.build/core/docs/SHELL_CONTRACT.md), `native-apps/mobile/ios`, `native-apps/mobile/android`).

| Шалгуур | Бүрэн native (Swift + Kotlin) | React Native / Flutter | **Native хүрээ + web муж** |
|---|---|---|---|
| Технологийн хязгаар | Байхгүй | Ихэнхдээ байхгүй, native модуль хэрэгтэй үед гүүр бичнэ | Байхгүй: аль ч дэлгэцийг route-оор нь native болгож болно |
| Арчилгаа | Хоёр кодын сан, дэлгэц бүр 2 удаа | Нэг сан, гэхдээ Nexus-ийн native нэвтрэлт, Keychain-ийг дахин бичнэ | Бизнесийн дэлгэц нэг (web). Native хэсэг жижиг, цөмөөс өвлөнө |
| Store-оор дамжуулалгүй шинэчлэх | Үгүй | Хэсэгчлэн (OTA) | Тийм: web муж шууд шинэчлэгдэнэ |
| eID app-to-app, Keychain, TLS pinning | Хийнэ | Дахин хийнэ | **Цөмд бэлэн** |
| 3D (three.js / web-ifc) | SceneKit/Filament-аар дахин хийнэ | WebView эсвэл native модуль | Web-ийн viewer-ийг шууд ашиглана (WKWebView/WebView WebGL) |

Шилжих дүрэм: web муж хангалтгүй болсон дэлгэцийг (AR, офлайн 3D, хүнд камер) **route-ийн түвшинд** native болгоно. Үлдсэн хэсэг өөрчлөгдөхгүй.

## 2. Агентад өгөх prompt

Доорх хэсгийг Claude Code эсвэл өөр кодлогч агентад бүтнээр нь өгнө.

````text
Чи E-Property (e-property.mn) платформын iOS болон Android аппыг хөгжүүлнэ.
Ажлын хавтас: e-property-mn (Gerege Nexus-ийн private distribution).
Цөмийн эх код: .build/core (core.lock-д заасан commit). Цөмийг fork хийхгүй.

## Зорилго
Үл хөдлөх хөрөнгийн төсөл, нэгж, захиалга, гэрээ, төлбөр, эрхийн бүртгэлийн явцыг
утаснаас хянах апп. Уриа: «Үл хөдлөх хөрөнгө үүсэхээс өмчлөх хүртэл.»
Шийдвэрлэсэн архитектур: native бүрхүүл + web ажлын муж (Bridge Contract v1.4).

## Эхлээд унш (код бичихээс өмнө)
1. .build/core/docs/SHELL_CONTRACT.md — window.GeregeShell гэрээ, нэг хүрээний дүрэм,
   capability, аюулгүй байдал, deep link.
2. .build/core/native-apps/README.md болон shared/device_lines.json — шугам, аппын нэр,
   нэвтрэлт, код хуваалцах дүрэм.
3. .build/core/native-apps/mobile/ios (project.yml, Design/, Features/Platform)
   ба mobile/android (shell/ShellBridge.kt, WorkAreaPolicy.kt, net/TlsPinning.kt).
4. .build/core/frontend/lib/shell.ts — web талын helper.
5. e-property-mn/docs/platform-blueprint.mn.md, brand-and-landing.mn.md,
   improvements-and-3d.mn.md, brand/ (theme.css, copy.json, logo.svg, icon.svg).
Уншсаны дараа олсон зүйлээ 10–15 мөрөөр нэгтгэж, асуулт, эрсдэлээ жагсаа.

## Хамгийн чухал шийдвэр: white-label
Цөмийн мобайл апп NexusGeregeMobile нэртэй, mobile.nexus.gerege.mn руу чиглэдэг.
E-Property-д өөр нэр, bundle ID, icon, өнгө, host хэрэгтэй.
- Цөмд брэнд солих механизм (build config, xcconfig, Gradle flavor, brand JSON) байгаа
  эсэхийг шалга.
- Байхгүй бол цөмд нэмэх upstream өөрчлөлтийн санал гарга (жижиг, буцаах боломжтой
  PR тодорхойлолт). E-Property талд зөвхөн брэндийн тохиргоо үлдэх ёстой.
- Хуулбар (fork) бол сүүлийн сонголт. Сонговол яагаад гэдгийг баримтжуул.
Энэ шийдвэрийг гаргаж, надаар батлуулсны дараа хэрэгжүүлэлт рүү ор.

## Native хэсэг (жижиг байлга)
- Нэвтрэлт: цөмийн eID app-to-app (geregesmartid://), fallback РД push.
- Нүүр «Миний нэгжүүд»: native жагсаалт, офлайн snapshot (Keychain/Keystore шифрлэлттэй),
  төлөвүүд тусдаа (барилга, борлуулалт, төлбөр, эрхийн хүсэлт).
- Push мэдэгдэл: төлбөрийн хугацаа, зураг/талбайн өөрчлөлт, албан хариу, хүлээлгэн өгөх.
- Биометр түгжээ, тохиргоо, хэл (mn, en; цөмийн 7 хэлний механизмаар).
- Баримт: камер/скан, файл хавсаргах, PDF хадгалах (гэрээ, баримт).
- Deep link / Universal Links / App Links: /projects/:id, /units/:id, /verify/:reference.
- Дизайны токен: цөмийн мобайл Theme.swift / Gw.kt бүтэц, E-Property өнгө
  (#142D4E, #087F8C, #F5F7FA, #192635), Noto Sans (кирилл). Тоо monospace.

## Web ажлын муж (e-property.mn, бүрхүүлийн горим)
- Төслүүд, хайлт, газрын зураг; төслийн паспорт; нэгжийн паспорт.
- Нэгжийн 3D: «Дүрслэл | Техникийн зураг» хоёр таб (improvements-and-3d.mn.md §3.1).
  Дүрслэлд талбай, хэмжээ харуулахгүй; тоо зөвхөн техникийн табаас.
- Захиалга, гэрээ, төлбөрийн явц, бүртгэлийн хүсэлтийн материал.
- Бүрхүүлийн горимд web өөрийн толгой, цэс, нэвтрэлтийг нууна (data-shell).
  Хөтчийн горим огт өөрчлөгдөхгүй.

## Route тохиргоо (server-driven)
Аль route-ийг native, аль нь web, аль нь modal, аль нь гадны хөтчөөр нээгдэхийг серверээс
татдаг JSON тохиргоогоор удирд (Hotwire Native-ийн path configuration-тай ижил санаа).
Апп хуучин хувилбартай байсан ч шинэ дүрэм ажиллах, мэдэгдээгүй route-ийг аюулгүйгээр
системийн хөтчөөр нээх. Тохиргоог гарын үсэгтэй эсвэл pinned TLS-ээр татах.

## Аюулгүй байдал (цөмийн дүрмийг дагана)
- Клиентэд secret байхгүй; бүх дуудлага same-origin /api/… route-аар.
- TLS pinning-ийг цөмийн жишгээр; allowlist-аас гадуурх host-ыг webview-д ачаалахгүй.
- JS bridge-ийн method бүрт origin болон capability шалгалт; хувийн мэдээллийг
  window дээр тавихгүй; QR/verify дээр хувийн мэдээлэл гаргахгүй.
- Гэрээ, төлбөрийн чухал үйлдэлд биометр эсвэл дахин баталгаажуулалт.
- Төлбөр: банк/QPay руу deep link эсвэл гадны урсгал; апп дотор картын мэдээлэл авахгүй.

## Store-ийн шаардлага
- iOS 4.2 «minimum functionality»: native нэвтрэлт, push, офлайн жагсаалт, биометр,
  баримт скан нь «зүгээр вэб сайт» биш гэдгийг харуулна.
- Нууцлалын бодлого, data safety, account deletion урсгал, permission тайлбарууд (mn/en).

## Хүлээн авах шалгуур
1. Хөтчийн горим өөрчлөгдөөгүй (цөмийн e2e/тест ногоон).
2. eID-ээр нэвтэрч, «Миний нэгжүүд» офлайнаар нээгдэнэ, сүлжээ ирэхэд шинэчлэгдэнэ.
3. Push-оос /units/:id руу шууд орж, буцах товч зөв ажиллана.
4. 3D viewer дунд түвшний Android (4 GB RAM) дээр 30+ fps, санах ойн алдаагүй.
5. Нэг route-ийг тохиргоогоор web→native болгоход апп шинэчлэхгүйгээр ажиллана.
6. Allowlist-аас гадуурх холбоос системийн хөтчөөр нээгдэнэ, webview-д ачаалагдахгүй.
7. iOS, Android хоёулаа CI-д компайл болж, unit тест (bridge, policy, route config) ногоон.
8. Хүртээмж: VoiceOver/TalkBack, Dynamic Type, контраст, статус зөвхөн өнгөөр биш.

## Ажлын дараалал ба тайлан
1. Судалгааны тайлан + white-label шийдэл (батлуулна).
2. Брэндийн тохиргоо, build, CI.
3. Нэвтрэлт + бүрхүүл + web муж (нэгжийн паспорт).
4. «Миний нэгжүүд» офлайн, push, deep link.
5. Route тохиргоо, баримт скан, биометр.
6. Store бэлтгэл.
Үе шат бүрийн төгсгөлд: юу хийсэн, тест, үлдсэн эрсдэл, дараагийн алхам.
Мэдэхгүй зүйлийг таамаглахгүй; цөмийн гэрээтэй зөрчилдвөл зогсоод асуу.
````

## 3. Тэмдэглэл

- Цөмийн мобайл апп одоогоор нэвтрэлт, самбар, ID, лог, тохиргоог хийсэн. Гарын үсэг, push, биометр, webview таб «хараахан хийгээгүй» гэж бичигдсэн (`native-apps/README.md`). Эдгээрийг E-Property-д тусад нь хийхийн оронд цөмд хийвэл бүх distribution ашиг хүртэнэ.
- Хост: `mobile.e-property.mn` гэх мэт төхөөрөмжийн шугамыг `device_lines.json`-ийн дүрмээр нэмнэ. DNS/TLS бэлэн болсны дараа клиент доторх хаягийг хамгийн сүүлд солино.
- **White-label (2026-10-03, батлагдсан):** fork хийхгүй. Цөмд брэндийн overlay нэмсэн ([nexus-gerege-private#138](https://github.com/gerege-systems/nexus-gerege-private/pull/138)): iOS `Brand.xcconfig` ← `Brand.local.xcconfig`, Android `-PbrandFile`. E-Property-ийн утгууд `mobile-brand/` хавтсанд: `mn.eproperty.app`, Gerege team `CQTHTD6YJQ`, scheme `eproperty`, хост `mobile.e-property.mn`, өнгө `#087F8C`/`#142D4E`, фонт Montserrat. `prepare-core.sh` эдгээрийг цөм рүү хуулна. Цөм `backend/v1.22.0`-д орсон; `.github/workflows/mobile.yml` хоёр аппыг барьж ID, scheme-ийг шалгана. Сервер: `mobile.e-property.mn` (nginx + TLS), `DEVICE_LINE_ORIGINS`, `EID_APP_CALLBACKS=eproperty://auth`.
- **3-р үе шат (2026-10-03):** нэвтрэлт ба бүрхүүл цөмийнх (eID app-to-app, webview ажлын муж). Web муж: `landing/units/` — нэгжийн жагсаалт ба паспорт (барилга / борлуулалт / төлбөр / эрхийн төлөв тусдаа; «Дүрслэл | Техникийн зураг» таб, тоо зөвхөн техникийн табад, зургийн эх файл ба SHA-256). Апп дотор (`window.GeregeShell`) толгой нуугдана. `mobile.e-property.mn/` нь жагсаалтыг нээнэ. Өгөгдөл одоохондоо `/3d/data`-ийн жишээ; төлбөр, эрхийн бүртгэл «Мэдээлэл холбогдоогүй».
- **4-р үе шат (2026-10-03):** (1) Deep link — `https://e-property.mn/units/…` аппын ажлын мужид нээгдэнэ (iOS Universal Links: AASA `/units/*`; Android App Links: `appLinksHost`/`appLinksPathPrefix`; нэвтрээгүй бол нэвтэрсний дараа). Android-ийн баталгаажуулалтад release гэрчилгээний `assetlinks.json` хэрэгтэй (6-р үе шат). (2) Офлайн «Миний нэгжүүд» — паспорт дээрх «Утсанд хадгалах» (bridge v1.5 `saved`): бүрхүүл snapshot-ыг шифрлэж самбар дээр сүлжээгүй үед ч харуулна, паспортыг нээх бүрд шинэчлэгдэнэ, гарахад устна. (3) Push — **хийгдээгүй**: цөмд иргэний push token ба APNs/FCM илгээгч байхгүй; Apple APNs түлхүүр, Firebase төсөл шаардлагатай.
- **5-р үе шат (2026-10-03):** (1) Серверийн route тохиргоо — `landing/shell-routes.json` (`mobile.e-property.mn/.well-known/gerege-shell-routes.json`), апп эхлэх бүрд pinned клиентээр татаж кэшлэнэ; `/saved` → native самбар, `/3d/data/` → системийн хөтөч. Апп шинэчлэхгүйгээр замыг web↔native болгоно. (2) Баримт скан — `/scan/` (bridge v1.6 `document.scan`: iOS VisionKit, Android ML Kit) → PDF, `fs.saveAs`-аар утсанд; сервер рүү илгээхгүй. (3) Биометр — Android-д `BiometricPrompt` (биометр эсвэл PIN), хадгалсан нэвтрэлт сэргээхэд түгжээ (iOS-тэй ижил); `biometric.authenticate` гэрээ/төлбөрийн үйлдэлд бэлэн (тэр урсгал web-д хараахан байхгүй).
- **6-р үе шат:** [`store-readiness.mn.md`](store-readiness.mn.md) — бэлэн зүйлс ба эзэмшигчийн шийдвэр/данс шаардах 8 зүйл.
