# E-Property Mobile — Store-д гаргах бэлэн байдал

Огноо: 2026-10-03. Цөм `backend/v1.28.0` (bridge v1.6). Энэ баримт нь
`mobile-app-prompt.mn.md`-ийн 6-р үе шат: юу бэлэн, юу эзэмшигчийн шийдвэр/данс
шаардана.

## Бэлэн

| | Байдал |
|---|---|
| Таних тэмдэг | `mn.eproperty.app` (iOS, Android), нэр «E-Property», Gerege team `CQTHTD6YJQ`, икон (`mobile-brand/`) |
| Build | `.github/workflows/mobile.yml` — хоёр аппыг цөмийн түгжсэн хувилбараас барьж ID, scheme, App Link-ийг шалгана |
| iOS 4.2 «minimum functionality» | Native: eID app-to-app нэвтрэлт, биометр түгжээ, офлайн «Хадгалсан» нэгжүүд, баримт скан (VisionKit), файл хадгалах, Universal Links, серверийн route тохиргоо |
| Зөвшөөрлийн тайлбар | iOS: `NSFaceIDUsageDescription`, `NSCameraUsageDescription` (mn + en). Android: зөвхөн `INTERNET`; скан нь Google Play services-ийн цонх тул камерын зөвшөөрөл аппад хэрэггүй |
| Universal Links | `https://e-property.mn/.well-known/apple-app-site-association` (`/units/*`) |

## Data safety / App Privacy-ийн хариу (кодоос)

| Өгөгдөл | Хаана | Зорилго |
|---|---|---|
| Нэр, регистр, иргэний бүртгэлийн дугаар, гэрчилгээний сериал, түвшин | Төхөөрөмж дээр (Keychain / Android Keystore AES-GCM); сервер рүү зөвхөн нэвтрэлтийн урсгалаар | Нэвтрэлт, апп-ын ажиллагаа |
| Хадгалсан нэгжүүд (гарчиг, төлөв) | Зөвхөн төхөөрөмж дээр, шифрлэсэн; гарахад устна | Офлайн жагсаалт |
| Скан хийсэн баримт | Зөвхөн хэрэглэгчийн сонгосон файл руу; сервер рүү илгээхгүй | Хэрэглэгчийн өөрийн хуулбар |
| Нэвтрэлтийн локал лог | Зөвхөн төхөөрөмж дээр | Хэрэглэгчид харуулах |

Зар сурталчилгаа, analytics, tracking SDK байхгүй. Гуравдагч SDK: OkHttp, AndroidX,
Google Play services ML Kit document scanner (Google-ийн өөрийн бодлогоор оношилгоо
цуглуулж болно — Play-ийн маягтад «Google Play services» гэж тэмдэглэнэ).

## Эзэмшигчийн шийдвэр, данс шаардлагатай

1. **Хуулийн этгээд ба холбоо барих суваг** — нууцлалын бодлогын хуудас (store-д URL
   заавал), дэмжлэгийн URL/имэйл. Агуулгыг дээрх хүснэгтээс бичнэ; хуулийн этгээдийн
   нэр, хаяг, имэйлийг зохиож бичихгүй.
2. **Бүртгэл устгах** (App Store 5.1.1(v), Google Play) — цөмд хэрэглэгчийн бүртгэл
   устгах урсгал байхгүй. Сонголт: (а) цөмд `DELETE /api/v1/me` (хадгалах хугацааны
   хуулийн шаардлагатай уялдуулна), (б) апп доторх «устгах хүсэлт» → оператор
   гараар (зохицуулалттай салбарт зөвшөөрөгдөнө; хүлээн авах суваг хэрэгтэй).
3. **Шалгагчийн нэвтрэлт** — нэвтрэлт нь зөвхөн eID Mongolia тул Apple/Google-ийн
   шалгагч нэвтэрч чадахгүй. Review-д зориулсан тест иргэн эсвэл demo горим хэрэгтэй.
4. **eID RP** — `EID_RP_UUID`, client гэрчилгээ/түлхүүрийг серверт; eID-ийн
   `callback_hosts`-д `eproperty://`. Үүнгүйгээр нэвтрэлт ажиллахгүй.
5. **Apple** — App Store Connect-д `mn.eproperty.app` бичлэг, Associated Domains ба
   Push капабилититай distribution profile, release build-ийг гарын үсэгтэй барих
   (одоогийн CI нь `CODE_SIGNING_ALLOWED=NO`).
6. **Google** — Play Console апп, upload key; Play App Signing-ийн SHA-256-аар
   `https://e-property.mn/.well-known/assetlinks.json` (тэр хүртэл Android App Link
   баталгаажихгүй, холбоос хөтчөөр нээгдэж болно).
7. **Push** — цөмд иргэний push token ба APNs/FCM илгээгч байхгүй; APNs түлхүүр,
   Firebase төсөл, цөмийн өөрчлөлт шаардлагатай.
8. **Store материал** — screenshot (6.7", 6.5", 5.5"; Android phone), тайлбар mn/en,
   ангилал (Business / House & Home), насны үнэлгээ.
