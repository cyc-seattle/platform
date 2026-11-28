// A Directus custom migration, mounted into Directus's migrations folder. Directus runs it once, at
// start, before it serves, and records it in directus_migrations. CommonJS, with no imports.
//
// A plan offering links to the catalog offering it plans (cyc-seattle/platform#395), which names its
// product and itself, so the plan offering's own product_id and name go. Each plan offering on the
// maintainer's reviewed list (.review/platform-395-2026-matches.md, 2026-11-28) links to the catalog
// offering it names there. Every other plan offering gets a catalog offering of its own, on no form and
// linked to no Clubspot class: one for each year's plan offerings that share a product, a name and
// dates, made from the one in a frozen Financial Plan if there is one, then the latest active, as the review
// lists them. A reviewed match whose catalog offering is gone stops the migration.
//
// It changes frozen Financial Plans, which the frozen-plans rules forbid, so their triggers are off for
// these statements. ALTER TABLE locks the table until the migration commits, so no other write gets in
// while they're off.
//
// It's one statement, so Postgres runs it in one transaction. It does nothing once
// `plan_offerings.product_id` is gone, or on a new database.

/** [plan offering, catalog offering], as the maintainer reviewed them. */
const REVIEWED = [
  ["0019ffcf-0b35-4fd5-9217-17084195b199", "3d114f7f-015a-478f-9fca-0eaf3da83729"],
  ["00729cb6-9eed-434f-9750-00b8fff017f7", "4e300d35-4c37-4f62-b741-f18f31431582"],
  ["00a245a4-0ed4-40e1-aeb1-4c7d8ef1a609", "34b806df-53bf-4812-8911-9fda6d106e13"],
  ["00d1c484-6c57-4919-8a46-7d28260d1f47", "4e300d35-4c37-4f62-b741-f18f31431582"],
  ["016dd661-c7b9-475a-86e2-f32c0e617f9e", "91421fea-8402-4e69-a182-86a018771089"],
  ["032016f2-113b-45da-9d26-a6c443e6a90a", "dfb0ffd4-6e12-4f75-8058-7d06f2fd24fb"],
  ["03dd3dd0-1384-406d-9ce6-f6361b56cdd7", "8f728683-4c7c-4c17-85eb-c0ef38b1fe78"],
  ["04dbcb18-bb5d-471f-8ce3-98631125c18c", "ee16e3cc-6b1f-4743-a3de-d552f48c0594"],
  ["0777ac90-03c6-466d-b571-3bab556db26a", "e71e0062-8820-475c-ad98-10503f76415a"],
  ["079041fd-9210-4d41-8185-ab955900c953", "985fc7b5-b763-4837-8248-a3ca400a7b60"],
  ["07995e97-f92a-4a11-bd06-dfec089361b1", "66deacb6-0515-48d5-8266-0e6f1ebf00ba"],
  ["0877c78d-325b-410a-a20e-5e92be7ace7c", "caa76ece-67ba-45fc-90d9-031f75bb6f04"],
  ["0b4e5eb0-28b2-4f46-8c35-6ae0c7cafdcd", "55f40e43-fcbe-4347-ba5d-9dede2d8932f"],
  ["0c1369c0-0200-56cd-80e1-b50592eee7fd", "3a11be5d-1569-4453-9957-b56187824e8e"],
  ["0c7c4e2a-1d72-41b6-99a4-a58a8a8f601d", "ee16e3cc-6b1f-4743-a3de-d552f48c0594"],
  ["0e438c70-f6bd-50c3-9819-c6842286c228", "854303d1-fd00-48c6-92d9-d3a2c132c2ba"],
  ["0e621ddb-7c54-4bb3-b6b3-f339262c3213", "226218ad-318e-44ac-b8c4-becc4e1d3d25"],
  ["0f42f061-e967-446f-8dd5-c8b7f72c7987", "55f40e43-fcbe-4347-ba5d-9dede2d8932f"],
  ["108a2333-1b98-4243-bac0-8e882e9efb8d", "7dcafe4d-7bf6-490b-9404-0b1c625fa12f"],
  ["1286d4d9-01f7-524a-9660-80538021b13e", "b08c64c9-6b6e-4498-9fc6-62fca8adb0fe"],
  ["13bbfc7a-d7d4-4bc4-ac5e-9f6f8e90e0ee", "f4d59f1c-eba8-4e67-83de-37fb8dc1b99f"],
  ["1462bb95-1954-5f81-9b47-8099df40927a", "2859d69e-978b-4218-8d34-3fbda65e1b99"],
  ["15a3cc63-c624-4b22-9cbb-a5b38332c5fd", "fecd2505-9236-489e-ba4b-b2071b7ac523"],
  ["161c90db-ca73-4e2d-84c3-fd32f565da03", "f4d59f1c-eba8-4e67-83de-37fb8dc1b99f"],
  ["168dfb9e-7643-54ad-bcfc-0134ed5c7c06", "e71e0062-8820-475c-ad98-10503f76415a"],
  ["173ad179-b39d-4fc5-9e07-48befc5ae613", "8389e333-63bf-43c8-b287-2f063a56a8eb"],
  ["173cf3a5-775d-5dae-8df1-12fbfe449e65", "fa7c671c-567d-4230-ae87-9eac8882bc43"],
  ["1831e966-fcde-4328-9378-87e3494e7a74", "2e80edaf-737d-407b-98b7-b17556ef6368"],
  ["1932633b-e493-4143-9c5c-8319976ff58e", "f0d15e0d-092a-459a-9d02-adf2eac4584b"],
  ["1961f7ed-abfb-40ac-b63b-253e3339bffa", "5282244e-a3ac-4337-a6e7-464b07542958"],
  ["19f897dc-bd59-5760-8f5b-03f7310b04af", "f0d15e0d-092a-459a-9d02-adf2eac4584b"],
  ["1a6261d5-0610-42cc-9ad3-63f023257437", "4cdc6ef1-e111-4cd5-a654-298f3c08873d"],
  ["1bef8597-eff9-4217-a4fc-ebde341cafee", "eedea5ef-3837-45e8-81bb-93a988d3702b"],
  ["1d331fa3-67af-4b08-8b16-2c8d39f93ea4", "eedea5ef-3837-45e8-81bb-93a988d3702b"],
  ["1e27527f-777b-5ee2-8c53-08608cec5bcc", "7dcafe4d-7bf6-490b-9404-0b1c625fa12f"],
  ["1fdd71ed-db9f-4a15-a62d-0fb33e7ac02d", "1fda1aca-13e1-4313-a346-fd3fc390727f"],
  ["201d4650-b64c-58ad-8e0f-c309218e3947", "66deacb6-0515-48d5-8266-0e6f1ebf00ba"],
  ["20ab61de-32d8-5005-b330-98a61a87cc81", "11d86d43-35e0-4f53-bf2e-5a6c765a0c6d"],
  ["2162f561-049b-4602-85e5-28ef88456426", "91421fea-8402-4e69-a182-86a018771089"],
  ["223f7e40-b50f-58a4-bbcd-9e098fa628c2", "34b806df-53bf-4812-8911-9fda6d106e13"],
  ["236da821-27d0-467b-9ed2-54767989b630", "e145584a-caad-46a7-a7a6-dea0932a9d42"],
  ["23ce028f-e12b-4bd9-b425-0bd27616b72e", "2859d69e-978b-4218-8d34-3fbda65e1b99"],
  ["23f8f2a1-e2ed-4b36-ba67-42cb4aab6dca", "5282244e-a3ac-4337-a6e7-464b07542958"],
  ["2420f908-1f3d-50fc-b454-a84731da467a", "25fb346c-cc38-461c-9133-df37da9119b7"],
  ["24f5fccf-847c-4b4e-bbd4-5ef1dacdec18", "ee16e3cc-6b1f-4743-a3de-d552f48c0594"],
  ["256c0988-0069-4de5-9f09-a75b1e888278", "730913d9-aee0-403a-ad61-b406e1fee6f7"],
  ["25ebb0b2-6714-497d-9fcf-48a354f4fb3d", "e145584a-caad-46a7-a7a6-dea0932a9d42"],
  ["263030a4-b640-42d6-ad6b-b76ddeddf487", "72906be9-db2e-4bc7-b68e-7690a181dc25"],
  ["2697a86d-3493-4b81-b640-7711795e07b4", "9c06a36c-aa72-41df-89f4-e40819d959ef"],
  ["26a6ed95-f541-48c2-ae03-836acb183b6f", "e71e0062-8820-475c-ad98-10503f76415a"],
  ["26feaa0a-b3a3-49f0-a59d-5f858a49d1c9", "caa76ece-67ba-45fc-90d9-031f75bb6f04"],
  ["273bf2c3-d0e3-5f96-971f-4c2ce4dfad64", "fecd2505-9236-489e-ba4b-b2071b7ac523"],
  ["285d93b5-2752-5d32-b0ff-7fa1e28903c0", "3d114f7f-015a-478f-9fca-0eaf3da83729"],
  ["2b8aa953-4cb7-5782-b959-3a1e3fc35e5e", "b40c71eb-495d-4434-a70d-dbf2b2b7d9b4"],
  ["2c506a69-3130-443d-be36-afa81295d374", "985fc7b5-b763-4837-8248-a3ca400a7b60"],
  ["2d4e4f64-7b3a-4b0c-bbab-e4936b58cefa", "34b806df-53bf-4812-8911-9fda6d106e13"],
  ["2e5784ca-d5e0-485f-9d3e-2ff6ce28123e", "dfb0ffd4-6e12-4f75-8058-7d06f2fd24fb"],
  ["2efcc1b7-8be9-47e9-9358-a3e3885895c3", "1fda1aca-13e1-4313-a346-fd3fc390727f"],
  ["2f768296-5604-49f3-a2ad-44214e990a95", "34b806df-53bf-4812-8911-9fda6d106e13"],
  ["301bed4d-8f27-4de7-a2fc-a9e047ef60e0", "caa76ece-67ba-45fc-90d9-031f75bb6f04"],
  ["3031741a-bb89-49dc-9127-8d764b84ba5c", "1f92ffe8-128f-4a2d-9750-26578781f3fb"],
  ["309e33a9-bbbc-4f59-908b-4b959bb3de4a", "2e80edaf-737d-407b-98b7-b17556ef6368"],
  ["30bb6b63-8861-47cc-875e-2261e0dd2a17", "dd2367aa-6a04-427c-8527-1a36cc9f7a31"],
  ["30f8fe5b-9c7a-4c99-8545-7b495574b0a9", "b40c71eb-495d-4434-a70d-dbf2b2b7d9b4"],
  ["3157f565-237c-4838-8be2-db51dd21ed5c", "073e6cee-6b6a-4f06-ba27-1bafeb5248b0"],
  ["31c2bf26-8d2d-4d3c-afbb-a2f9c8ede28b", "72906be9-db2e-4bc7-b68e-7690a181dc25"],
  ["31d4785c-662a-446b-a66c-ef91cf332c83", "ca58fd0e-6606-4333-849d-4cd7152432e5"],
  ["33ce5e2e-0e3b-4e57-ba76-a39ff379518d", "b12614d6-9abc-4757-9041-2feec5ff738a"],
  ["3411f42b-5dac-4062-8928-b375d9c6a656", "1f92ffe8-128f-4a2d-9750-26578781f3fb"],
  ["3474a62f-f99b-40b7-a05a-3d02b70e5e13", "2e80edaf-737d-407b-98b7-b17556ef6368"],
  ["34bb1623-9f1c-49fc-b38a-52f320e5130b", "dd2367aa-6a04-427c-8527-1a36cc9f7a31"],
  ["356c2533-aa56-4f39-96ff-5646a89d7342", "dd2367aa-6a04-427c-8527-1a36cc9f7a31"],
  ["36687daa-2daf-470c-bbbb-95bba3aaf619", "3a11be5d-1569-4453-9957-b56187824e8e"],
  ["383248d8-0e4d-4616-9579-768a4d324d55", "b40c71eb-495d-4434-a70d-dbf2b2b7d9b4"],
  ["38cd9e47-ad78-49fc-8db7-5c6fe1b34ef2", "dfb0ffd4-6e12-4f75-8058-7d06f2fd24fb"],
  ["3a0d8496-cc36-4857-98df-c8fedd81decc", "b12614d6-9abc-4757-9041-2feec5ff738a"],
  ["3b0d7e10-61bd-49d3-b807-cc4ceb5d0fb7", "2e80edaf-737d-407b-98b7-b17556ef6368"],
  ["3b3d7617-0e44-41f0-93ea-4eb4852a3646", "66deacb6-0515-48d5-8266-0e6f1ebf00ba"],
  ["3daac63d-9e4c-447d-ba6c-c1c71402bff7", "6ed5e130-0ea8-4a87-b3cb-bf2970b5510f"],
  ["3e59232c-8ee1-47a5-bc70-5e5330984659", "dd2367aa-6a04-427c-8527-1a36cc9f7a31"],
  ["3fe84562-f9e9-44de-a4ed-08d7fd315df7", "55f40e43-fcbe-4347-ba5d-9dede2d8932f"],
  ["3ff00f9f-ef4a-4619-96c6-ca0d8e5c522d", "ee16e3cc-6b1f-4743-a3de-d552f48c0594"],
  ["40754730-02eb-4ec7-bd00-58d42904ed2c", "073e6cee-6b6a-4f06-ba27-1bafeb5248b0"],
  ["40cb042b-7ff1-49e7-adf0-6e4f0d0746c7", "5282244e-a3ac-4337-a6e7-464b07542958"],
  ["42259aaf-b3eb-4356-80e5-0f57bb896062", "2859d69e-978b-4218-8d34-3fbda65e1b99"],
  ["434d435e-46b0-5185-b7d6-f501585367ad", "1fda1aca-13e1-4313-a346-fd3fc390727f"],
  ["4394e249-2252-44df-9d0e-eede72c7357d", "b9b10af2-1528-4530-94af-1cefeb092a25"],
  ["439837a8-9583-4118-a177-f119dd54d03c", "bff99d80-159c-49b4-ba53-4f9cb26bca47"],
  ["43de10cd-64f2-4143-92ae-341d082c9aa4", "9c06a36c-aa72-41df-89f4-e40819d959ef"],
  ["447e6a88-d3e8-5ada-aca3-05271e431168", "1f92ffe8-128f-4a2d-9750-26578781f3fb"],
  ["44d8b2dc-9026-4d70-8dc8-39d51f961b2b", "dfb0ffd4-6e12-4f75-8058-7d06f2fd24fb"],
  ["4613a607-5460-4545-80b1-b3452142cb4b", "ee16e3cc-6b1f-4743-a3de-d552f48c0594"],
  ["47f7fd5b-520b-40cd-b630-5f3431868dc4", "caa76ece-67ba-45fc-90d9-031f75bb6f04"],
  ["487e6552-18e1-4679-a6fa-1b34f581a425", "e71e0062-8820-475c-ad98-10503f76415a"],
  ["4882f277-a21a-44f9-a917-e78cb8ccefe5", "b08c64c9-6b6e-4498-9fc6-62fca8adb0fe"],
  ["49d9dd5e-4a58-42ef-addc-caac5e576887", "1fda1aca-13e1-4313-a346-fd3fc390727f"],
  ["4a409b97-19bd-4ef3-8a08-28dbd2722ed3", "66deacb6-0515-48d5-8266-0e6f1ebf00ba"],
  ["4a9ff6ce-38d7-5a28-b939-2081e46d37ef", "bff99d80-159c-49b4-ba53-4f9cb26bca47"],
  ["4af66e7f-4f2d-4b99-bc34-75f573062b4b", "0a002256-5db8-4a7c-9cf5-0143b59bd3ea"],
  ["4bcfd2be-4e11-4e56-b7dd-5ac95bb6988c", "b07c0240-ad1b-4e68-b966-3663dace7c7e"],
  ["4fa8d0b2-da93-43e7-abe8-a8b891be6ad9", "9497b162-e911-4553-8e08-e811113aae6d"],
  ["52593bcf-f4c1-4f00-a7e4-3e805f4393d9", "7dcafe4d-7bf6-490b-9404-0b1c625fa12f"],
  ["52bcd8ff-312c-55a0-b3e1-77515a4b44ed", "8f728683-4c7c-4c17-85eb-c0ef38b1fe78"],
  ["52f057de-2869-49a3-bed9-f9067d8c9a56", "073e6cee-6b6a-4f06-ba27-1bafeb5248b0"],
  ["52f45351-2d62-4946-bc0c-ebba8b682a4d", "730913d9-aee0-403a-ad61-b406e1fee6f7"],
  ["54649b93-2a80-4022-9639-6f87af6dea60", "11d86d43-35e0-4f53-bf2e-5a6c765a0c6d"],
  ["54d76b18-e2c9-405a-8ad7-6606ca7f7d7b", "fa7c671c-567d-4230-ae87-9eac8882bc43"],
  ["55e094f4-0b5f-4055-bd79-8dd019ca54fd", "985fc7b5-b763-4837-8248-a3ca400a7b60"],
  ["5771d897-eb17-577e-bc73-6403e2195b1b", "caa76ece-67ba-45fc-90d9-031f75bb6f04"],
  ["593bc8cd-ff4d-44fd-92df-f27823667826", "1f92ffe8-128f-4a2d-9750-26578781f3fb"],
  ["5ae5e84e-a5af-4c74-8dcc-d1535175b544", "4cdc6ef1-e111-4cd5-a654-298f3c08873d"],
  ["5ce0e7eb-6ee1-418b-b4be-9b770d3f579e", "b9b10af2-1528-4530-94af-1cefeb092a25"],
  ["5d36e1c7-b588-4ddc-91cc-9befc7949985", "8f728683-4c7c-4c17-85eb-c0ef38b1fe78"],
  ["5e0a4d43-40af-441f-aad7-de30536f2060", "55f40e43-fcbe-4347-ba5d-9dede2d8932f"],
  ["5ebb3e87-9e2f-4e3c-8cc8-613192c2d2ab", "b9b10af2-1528-4530-94af-1cefeb092a25"],
  ["5eea507d-6613-4f42-bab2-a52006a244af", "11d86d43-35e0-4f53-bf2e-5a6c765a0c6d"],
  ["5ff244dc-84f4-5bea-b3b3-ff28e2afb88c", "ca58fd0e-6606-4333-849d-4cd7152432e5"],
  ["6215c740-8230-4839-b38f-a047107162a1", "72906be9-db2e-4bc7-b68e-7690a181dc25"],
  ["63652767-60a6-4119-bad4-2de26a9ff2dd", "bff99d80-159c-49b4-ba53-4f9cb26bca47"],
  ["63e710ea-d05f-55e5-8492-72a36c420c84", "9c06a36c-aa72-41df-89f4-e40819d959ef"],
  ["641d34bb-d0fe-47b6-b4ed-78e39516e333", "eedea5ef-3837-45e8-81bb-93a988d3702b"],
  ["67a166b7-5b6b-439b-a58b-816002842adc", "3d114f7f-015a-478f-9fca-0eaf3da83729"],
  ["681951fa-60c3-4465-871d-f509d932efc8", "811646cc-1be2-42eb-9192-650a5a922067"],
  ["69588848-961a-4d47-a102-770b06db7c42", "a905deaf-cffa-42b5-8ecb-0f231727111d"],
  ["69890c48-7baa-4f1c-9c49-6053b27f9d2d", "073e6cee-6b6a-4f06-ba27-1bafeb5248b0"],
  ["6b5e674a-6db9-4cf3-a87f-b7f957a552c5", "8389e333-63bf-43c8-b287-2f063a56a8eb"],
  ["6b664e93-d05e-4d24-980c-aed656abf532", "bff99d80-159c-49b4-ba53-4f9cb26bca47"],
  ["6cd18c58-2c64-4529-b877-4b95b1c6c48c", "e145584a-caad-46a7-a7a6-dea0932a9d42"],
  ["6d02f5c7-ae85-44e4-a05c-f784b2438a9b", "7dcafe4d-7bf6-490b-9404-0b1c625fa12f"],
  ["6d9dd3a3-8415-48ce-9980-917b60643f88", "5282244e-a3ac-4337-a6e7-464b07542958"],
  ["6e515e61-c72b-45a6-a635-e16abcdf6f79", "4cdc6ef1-e111-4cd5-a654-298f3c08873d"],
  ["6e55b11b-5cda-539c-8aec-951ad329a029", "b12614d6-9abc-4757-9041-2feec5ff738a"],
  ["7064b074-38c8-5950-89a6-4cb15c88cbc9", "9497b162-e911-4553-8e08-e811113aae6d"],
  ["71564b88-9991-5dc2-8cf8-14a5ff11a57f", "811646cc-1be2-42eb-9192-650a5a922067"],
  ["72996bc7-7c7d-5014-b43e-a630afcdfcdb", "b07c0240-ad1b-4e68-b966-3663dace7c7e"],
  ["7311d919-73ef-4168-b743-e97148b8d7c5", "bff99d80-159c-49b4-ba53-4f9cb26bca47"],
  ["73bfa7f6-bf77-4c7e-9e8f-4f819417b5f8", "226218ad-318e-44ac-b8c4-becc4e1d3d25"],
  ["74851531-23ec-424a-a548-7502240809fc", "b08c64c9-6b6e-4498-9fc6-62fca8adb0fe"],
  ["75b18eec-0cef-4d11-8222-d93ae0b0a113", "fa6c75fa-50bb-44e1-bb6a-c38d7a491d30"],
  ["764b4194-90c3-4239-bc48-fedcd01e9a65", "f0d15e0d-092a-459a-9d02-adf2eac4584b"],
  ["7654e4ee-ef99-45b4-8574-056b2501dc92", "9497b162-e911-4553-8e08-e811113aae6d"],
  ["7966109f-0a35-4287-9acc-9d9f01ba509d", "ee16e3cc-6b1f-4743-a3de-d552f48c0594"],
  ["7a564fd2-f014-4267-88ba-9d620684da2f", "b12614d6-9abc-4757-9041-2feec5ff738a"],
  ["7c57a61f-618c-576a-bd16-8d11193b0687", "0a002256-5db8-4a7c-9cf5-0143b59bd3ea"],
  ["7d82f14c-8500-4bf2-8c27-a3b84cc25f1d", "4e300d35-4c37-4f62-b741-f18f31431582"],
  ["7e97dc15-5931-4a1f-b24e-feec80468652", "9432184d-9523-46c9-8bfc-a730e97ab5df"],
  ["80a24b60-dcee-4a0f-a3f5-f7e9be67bec5", "e71e0062-8820-475c-ad98-10503f76415a"],
  ["83239357-efc0-43d8-8e7f-f51db98f88b0", "fa7c671c-567d-4230-ae87-9eac8882bc43"],
  ["834f1fc5-c8ff-46f5-8e6f-7d6edc6236a3", "b08c64c9-6b6e-4498-9fc6-62fca8adb0fe"],
  ["83c42477-12bc-5e7d-aab8-46df812f1090", "073e6cee-6b6a-4f06-ba27-1bafeb5248b0"],
  ["84379cdc-41a4-4cd8-b647-7e200f6b00e2", "fa7c671c-567d-4230-ae87-9eac8882bc43"],
  ["84386d26-fcb4-4b7f-b495-160a39e18728", "8389e333-63bf-43c8-b287-2f063a56a8eb"],
  ["84fb4042-ef57-423d-9ccd-d0a7d9b33c3f", "caa76ece-67ba-45fc-90d9-031f75bb6f04"],
  ["86bcd439-bd42-4724-976d-f17862a94358", "226218ad-318e-44ac-b8c4-becc4e1d3d25"],
  ["871b4e52-9641-48ab-b3b2-9f8f3e08733e", "91421fea-8402-4e69-a182-86a018771089"],
  ["8850f1d3-855a-545f-9004-9a8f6007abba", "9432184d-9523-46c9-8bfc-a730e97ab5df"],
  ["88af1b88-6de7-49a7-a92a-985216546898", "91421fea-8402-4e69-a182-86a018771089"],
  ["89d94577-193d-4b73-8c2e-b6d57ca637f1", "eedea5ef-3837-45e8-81bb-93a988d3702b"],
  ["8a4d4e27-3059-4540-b116-e7a4fbc28c9d", "4cdc6ef1-e111-4cd5-a654-298f3c08873d"],
  ["8af9464e-0427-4e41-9f00-db7520e162c3", "9497b162-e911-4553-8e08-e811113aae6d"],
  ["8d87ed33-250d-4f1d-b88f-20dedd7a546f", "bff99d80-159c-49b4-ba53-4f9cb26bca47"],
  ["8fadbb30-a730-40b1-b9d7-05a31e16952a", "9497b162-e911-4553-8e08-e811113aae6d"],
  ["8fc5df63-4f45-472b-9a2b-14f9c5b63fac", "226218ad-318e-44ac-b8c4-becc4e1d3d25"],
  ["8fe11ed8-d322-5bc9-936d-9252d7e7025f", "730913d9-aee0-403a-ad61-b406e1fee6f7"],
  ["9015a209-f90d-5cc9-91b2-2ec4650f5b98", "b9b10af2-1528-4530-94af-1cefeb092a25"],
  ["901c08dd-2972-529c-ab17-d8dcdccaf66f", "226218ad-318e-44ac-b8c4-becc4e1d3d25"],
  ["901e3ff7-6d08-4a5d-bf9b-afd52ee11157", "eedea5ef-3837-45e8-81bb-93a988d3702b"],
  ["90e9ffbf-d47d-46e9-94ce-c197b94fbf3c", "2859d69e-978b-4218-8d34-3fbda65e1b99"],
  ["911fdc82-4c05-4950-a287-6c75993a469a", "b40c71eb-495d-4434-a70d-dbf2b2b7d9b4"],
  ["91ab053b-26fc-4b82-95cc-4e3d26b99e78", "3d114f7f-015a-478f-9fca-0eaf3da83729"],
  ["91c0ca70-d06f-479a-9e2b-5ca53c29214b", "4e300d35-4c37-4f62-b741-f18f31431582"],
  ["91dbe25a-ab83-4be2-8127-d15dec48e293", "11d86d43-35e0-4f53-bf2e-5a6c765a0c6d"],
  ["91e0f932-226b-43d2-92dd-03f4082b702c", "e145584a-caad-46a7-a7a6-dea0932a9d42"],
  ["9320da86-0dfa-5381-9ab7-4153701de1df", "985fc7b5-b763-4837-8248-a3ca400a7b60"],
  ["93703958-1a40-4f11-b7b6-7bf41ffe501d", "66deacb6-0515-48d5-8266-0e6f1ebf00ba"],
  ["93d5496b-e9c3-5ab5-85cd-325a33938a3e", "6ed5e130-0ea8-4a87-b3cb-bf2970b5510f"],
  ["940289dc-33dc-4ac2-9dd1-493e31af1822", "72906be9-db2e-4bc7-b68e-7690a181dc25"],
  ["952fee93-4c52-54d4-ae34-b679bb834a22", "91421fea-8402-4e69-a182-86a018771089"],
  ["95477a37-990c-4fe1-8da4-b6719d080a6c", "8f728683-4c7c-4c17-85eb-c0ef38b1fe78"],
  ["97a33cad-45f4-4072-8ebb-6638dd7d4b6d", "a71db11e-bd83-4913-807c-c23f4e8af823"],
  ["97fb960f-1dc7-4eb7-b4db-4021c7729b46", "b9b10af2-1528-4530-94af-1cefeb092a25"],
  ["980f536b-ff3e-4353-90f0-1695a4a3a7d0", "a905deaf-cffa-42b5-8ecb-0f231727111d"],
  ["9830e8d6-0954-433c-b2d9-7d599ca2bf1d", "34b806df-53bf-4812-8911-9fda6d106e13"],
  ["983a8b11-5d4a-4089-8186-37e8a4b98c10", "2e80edaf-737d-407b-98b7-b17556ef6368"],
  ["98c45fb9-1b8b-436e-bd5b-3f6da164873e", "9497b162-e911-4553-8e08-e811113aae6d"],
  ["98f167ed-5eb8-4dd4-99b5-e1e4e0221fcd", "730913d9-aee0-403a-ad61-b406e1fee6f7"],
  ["9917b7ae-56a5-4399-8020-74a6c1b74088", "730913d9-aee0-403a-ad61-b406e1fee6f7"],
  ["99ef9a6c-f528-4f01-bb6b-2bd8ad9ad78f", "fa7c671c-567d-4230-ae87-9eac8882bc43"],
  ["9c6ab3b5-22b9-41b5-b130-a7fe3bf2b1a1", "4cdc6ef1-e111-4cd5-a654-298f3c08873d"],
  ["9cf24484-06b4-4578-ad68-275f80cdc450", "5d685057-9315-4ea5-831f-9c5030a1b0c6"],
  ["9d213a71-73b5-494c-a078-250f892ad67d", "91421fea-8402-4e69-a182-86a018771089"],
  ["9d82ce62-b8d7-49e4-80e4-a95a9ba66dcf", "11d86d43-35e0-4f53-bf2e-5a6c765a0c6d"],
  ["9dd24053-f075-4d93-9590-4d464bbf25f0", "61942a7e-0be7-47d5-b547-46fe1dcb7657"],
  ["a06e0707-45fa-4b53-a359-29030e0dbc35", "f4d59f1c-eba8-4e67-83de-37fb8dc1b99f"],
  ["a0f7f807-c24a-4cb2-96b8-4c2b8011a57d", "f4d59f1c-eba8-4e67-83de-37fb8dc1b99f"],
  ["a1ac82dc-3e82-4e93-ade1-c781b414b193", "55f40e43-fcbe-4347-ba5d-9dede2d8932f"],
  ["a2228315-4124-4702-acd7-f6586ce832ea", "4cdc6ef1-e111-4cd5-a654-298f3c08873d"],
  ["a2df14c4-e348-498f-b1cd-dc2632692c0e", "b08c64c9-6b6e-4498-9fc6-62fca8adb0fe"],
  ["a3bb9c14-8c66-5bf0-ab60-3de2f8b934cb", "4e300d35-4c37-4f62-b741-f18f31431582"],
  ["a62e49d4-ee01-4103-9b84-bff9e22ac7fa", "8f728683-4c7c-4c17-85eb-c0ef38b1fe78"],
  ["aab41bb6-a38c-4766-8d0c-4354311f973c", "e2755bb5-bfb8-444f-93ab-c8267e5b7989"],
  ["aba8d5f2-b4ca-42c2-985b-6a943fca689f", "b12614d6-9abc-4757-9041-2feec5ff738a"],
  ["abe691e0-80ae-48a3-94ed-33d65d2be8dc", "3d114f7f-015a-478f-9fca-0eaf3da83729"],
  ["ac14237e-c0cb-478c-9990-98ab56bfe0ec", "1fda1aca-13e1-4313-a346-fd3fc390727f"],
  ["aca5be91-2ad6-41db-ae7c-592b1943e2b9", "730913d9-aee0-403a-ad61-b406e1fee6f7"],
  ["acce1c76-8a52-449d-a767-2803f4827ac7", "b08c64c9-6b6e-4498-9fc6-62fca8adb0fe"],
  ["ad67fa7b-163c-5ef5-8c0c-253214fc06cd", "eedea5ef-3837-45e8-81bb-93a988d3702b"],
  ["ae45b79a-8177-44b2-8b4c-c2344f7af85c", "1f92ffe8-128f-4a2d-9750-26578781f3fb"],
  ["ae732f74-ca5c-45e2-8ff7-7c56bb88f015", "eedea5ef-3837-45e8-81bb-93a988d3702b"],
  ["af038f12-55cc-45ee-a0a9-84cc60290ee0", "9c06a36c-aa72-41df-89f4-e40819d959ef"],
  ["af0cd618-6d91-49df-a69b-f248b722ac8f", "2859d69e-978b-4218-8d34-3fbda65e1b99"],
  ["b104e551-4404-57c9-89a7-6193df4719db", "61942a7e-0be7-47d5-b547-46fe1dcb7657"],
  ["b27fb010-2b1e-5fb1-bde5-abc1ba4e6f37", "dfb0ffd4-6e12-4f75-8058-7d06f2fd24fb"],
  ["b2888f22-35f3-5e46-a504-81603053f4ef", "d1db0b02-a716-4588-86b8-154b88b9a508"],
  ["b3affc95-9911-45f4-8bdf-6a87635cc122", "1fda1aca-13e1-4313-a346-fd3fc390727f"],
  ["b3e9860e-346c-537d-a1fb-8d8fc5c7ae87", "2e80edaf-737d-407b-98b7-b17556ef6368"],
  ["b3f4a59b-fe3b-48b8-8404-b9a635321a7b", "f0d15e0d-092a-459a-9d02-adf2eac4584b"],
  ["b55b5327-6210-4aa2-b42e-7601b0b9c41f", "b12614d6-9abc-4757-9041-2feec5ff738a"],
  ["b59358f2-77fd-4725-a9f8-9d5b127ba1d8", "bff99d80-159c-49b4-ba53-4f9cb26bca47"],
  ["b73189c7-58d1-41f1-807a-048a0c1cca31", "dfb0ffd4-6e12-4f75-8058-7d06f2fd24fb"],
  ["b849e3ac-e5ea-4b46-a2a6-232badc14106", "730913d9-aee0-403a-ad61-b406e1fee6f7"],
  ["b9f61c55-3563-58b2-bca1-a85cc73cabe0", "55f40e43-fcbe-4347-ba5d-9dede2d8932f"],
  ["bae1820f-2f93-4f5b-a108-7b6a5a4b41c9", "fa7c671c-567d-4230-ae87-9eac8882bc43"],
  ["bae7af3e-a114-471f-8428-9a064a73ae4f", "b9b10af2-1528-4530-94af-1cefeb092a25"],
  ["bca579c5-18b8-48bf-9fda-93e95ba15fc5", "e145584a-caad-46a7-a7a6-dea0932a9d42"],
  ["be84c5b6-c021-44ff-8a60-246369aaa0df", "2e80edaf-737d-407b-98b7-b17556ef6368"],
  ["bf147877-82b1-45b7-83ce-ac1243c81b8d", "dd2367aa-6a04-427c-8527-1a36cc9f7a31"],
  ["bf36dfe2-6cda-5a21-aa65-b15829a80eb0", "5282244e-a3ac-4337-a6e7-464b07542958"],
  ["bf7b6721-7e4b-4e9a-85ef-e937b71dd3cd", "fa7c671c-567d-4230-ae87-9eac8882bc43"],
  ["c020f94e-2290-43d2-9df8-cc17fd619dca", "9c06a36c-aa72-41df-89f4-e40819d959ef"],
  ["c081a8ae-87d0-484a-b138-f68d406a77e5", "5282244e-a3ac-4337-a6e7-464b07542958"],
  ["c0bdf74e-f6a6-40d8-92e6-6de08421529b", "d1db0b02-a716-4588-86b8-154b88b9a508"],
  ["c19b6a86-f2ed-40af-bc16-b91fb120fb70", "7dcafe4d-7bf6-490b-9404-0b1c625fa12f"],
  ["c2165548-0adf-4dba-aa71-fe969c512ad2", "7dcafe4d-7bf6-490b-9404-0b1c625fa12f"],
  ["c2fdcb4c-3cb5-414d-ae0e-da1c1069bb8e", "4e300d35-4c37-4f62-b741-f18f31431582"],
  ["c388e6be-10c9-490f-a954-8ff1dbd05987", "3d114f7f-015a-478f-9fca-0eaf3da83729"],
  ["c4f14d4f-a9ef-4d80-87ae-081120ad1822", "4e300d35-4c37-4f62-b741-f18f31431582"],
  ["c6007ee5-5fe2-547b-a117-872f607cc0a3", "a71db11e-bd83-4913-807c-c23f4e8af823"],
  ["c7a49037-49ea-4f2a-b61a-1edbc871a56a", "f0d15e0d-092a-459a-9d02-adf2eac4584b"],
  ["c8beee7f-ac92-44d5-833b-97738c5d7d9a", "34b806df-53bf-4812-8911-9fda6d106e13"],
  ["c9fe3deb-530f-4a6c-a1b4-7ef05dce8bc1", "f0d15e0d-092a-459a-9d02-adf2eac4584b"],
  ["ca3d6f77-94a0-5920-9647-3d9570d7cef4", "dd2367aa-6a04-427c-8527-1a36cc9f7a31"],
  ["caafc0ad-5bc4-4ca5-ac95-76f1eee6ac9a", "34b806df-53bf-4812-8911-9fda6d106e13"],
  ["cb4d4be9-24f8-50bb-bf79-0666664ab34f", "4cdc6ef1-e111-4cd5-a654-298f3c08873d"],
  ["cca576ae-0d93-45bd-becf-1c876ddfc9c8", "dfb0ffd4-6e12-4f75-8058-7d06f2fd24fb"],
  ["cf02016d-1760-4647-b9a2-960ad87e61c5", "8389e333-63bf-43c8-b287-2f063a56a8eb"],
  ["cfaf5cf6-6f48-4978-99e1-97286ab703a4", "f4d59f1c-eba8-4e67-83de-37fb8dc1b99f"],
  ["cffc95af-d2d6-49a6-a5b2-77a489eccff4", "1f92ffe8-128f-4a2d-9750-26578781f3fb"],
  ["d06d7bcb-503e-49a4-a61d-1672bc1bfd6c", "8389e333-63bf-43c8-b287-2f063a56a8eb"],
  ["d0ecaa84-fa29-4832-8f19-fd5f0e742b29", "e71e0062-8820-475c-ad98-10503f76415a"],
  ["d1bc5c89-b0ab-4b0e-9c2a-3c4076c702fd", "9c06a36c-aa72-41df-89f4-e40819d959ef"],
  ["d3a0028b-dc7d-48c8-a6af-f1bae174005b", "8389e333-63bf-43c8-b287-2f063a56a8eb"],
  ["d3b2361b-9095-4758-8d6f-2d2e2952dcd9", "91421fea-8402-4e69-a182-86a018771089"],
  ["d3bd559f-6ced-4561-9eb2-5ffd768fdb55", "11d86d43-35e0-4f53-bf2e-5a6c765a0c6d"],
  ["d3d0ec06-6654-5aac-8ba0-4e256599413f", "9994672a-317e-453b-a792-17ccdd4bf2f4"],
  ["d479aef9-15ae-4ddd-973f-00f9ba5182b9", "66deacb6-0515-48d5-8266-0e6f1ebf00ba"],
  ["d49f68d4-1748-44db-b2f4-129ffdbab460", "226218ad-318e-44ac-b8c4-becc4e1d3d25"],
  ["d58e37b7-a10a-5582-922d-001ad551f891", "ee16e3cc-6b1f-4743-a3de-d552f48c0594"],
  ["d690c0d4-f624-4f3e-a004-6cfad23175f6", "9c06a36c-aa72-41df-89f4-e40819d959ef"],
  ["d69a153d-2648-40e2-b2e5-710f6820e7a7", "b08c64c9-6b6e-4498-9fc6-62fca8adb0fe"],
  ["d6add52b-c508-4540-b6cc-f75326762b14", "f4d59f1c-eba8-4e67-83de-37fb8dc1b99f"],
  ["d6d2b88b-4585-4ae4-94a0-6e179c3a47f4", "854303d1-fd00-48c6-92d9-d3a2c132c2ba"],
  ["d710759d-3baf-4751-9757-8d09834c2617", "073e6cee-6b6a-4f06-ba27-1bafeb5248b0"],
  ["d762d842-b6f3-5aa6-8bdb-67207c61efdf", "fa6c75fa-50bb-44e1-bb6a-c38d7a491d30"],
  ["d88ce91d-1e1e-4d27-b3e9-4741c6673358", "72906be9-db2e-4bc7-b68e-7690a181dc25"],
  ["da3d8f5e-b529-4587-ade5-a3c1431c1296", "66deacb6-0515-48d5-8266-0e6f1ebf00ba"],
  ["db8a3a9d-b754-466f-81d7-181aa51566a2", "72906be9-db2e-4bc7-b68e-7690a181dc25"],
  ["dd80860f-4ad2-4dd6-945f-9dff63ea81c0", "8f728683-4c7c-4c17-85eb-c0ef38b1fe78"],
  ["deaa199c-da3e-48d7-abba-9dac2569e110", "2859d69e-978b-4218-8d34-3fbda65e1b99"],
  ["df25e571-c7b9-491f-b4c0-a3a6ce7f4d6e", "f0d15e0d-092a-459a-9d02-adf2eac4584b"],
  ["df27a5fb-1b8d-4367-bd52-f01a970b1165", "073e6cee-6b6a-4f06-ba27-1bafeb5248b0"],
  ["df4f5e0d-e7dd-46c6-8065-072c7592bb77", "a905deaf-cffa-42b5-8ecb-0f231727111d"],
  ["e236ae55-976b-43f9-82da-bb50a0a0f79c", "a905deaf-cffa-42b5-8ecb-0f231727111d"],
  ["e28bae78-bb4c-4ff6-8f76-9c02a5df055a", "7b03cc4f-c47a-4fdc-8792-ca4501db71f3"],
  ["e5be4128-f39c-4def-9298-e38e20f7cc31", "55f40e43-fcbe-4347-ba5d-9dede2d8932f"],
  ["e7798aee-6fe5-4113-96fc-02be5fc7fc29", "e145584a-caad-46a7-a7a6-dea0932a9d42"],
  ["e8ef84c5-7b2a-49dc-a392-b4d67b20ee39", "985fc7b5-b763-4837-8248-a3ca400a7b60"],
  ["e910530e-d286-544b-a4f4-d8badd59e2df", "a905deaf-cffa-42b5-8ecb-0f231727111d"],
  ["ec15dbea-0bd6-5e8d-aad8-afa71b7e9058", "e145584a-caad-46a7-a7a6-dea0932a9d42"],
  ["ec733335-ee7b-4566-ae21-3e2df99189f9", "b40c71eb-495d-4434-a70d-dbf2b2b7d9b4"],
  ["ec893d6a-cdb3-458e-892c-cf2e18e204d5", "2859d69e-978b-4218-8d34-3fbda65e1b99"],
  ["ede2910e-c249-5e64-be09-1f5bf4c3aed0", "f4d59f1c-eba8-4e67-83de-37fb8dc1b99f"],
  ["ef1c9828-dfc2-5604-bf4e-d34151b5c0f0", "5d685057-9315-4ea5-831f-9c5030a1b0c6"],
  ["ef6a474b-dc87-40e7-841f-49c9e11b4afe", "1f92ffe8-128f-4a2d-9750-26578781f3fb"],
  ["f06b05f1-5aa3-469b-8b4a-fec0a0d03e82", "11d86d43-35e0-4f53-bf2e-5a6c765a0c6d"],
  ["f070f712-5091-48fa-a6b4-bcd25e84f4b4", "7dcafe4d-7bf6-490b-9404-0b1c625fa12f"],
  ["f0c5ef1d-bd33-4f7b-bfb3-8412a5c5cef0", "dd2367aa-6a04-427c-8527-1a36cc9f7a31"],
  ["f25d09a9-c4bc-4a00-b519-03a4c8741643", "b40c71eb-495d-4434-a70d-dbf2b2b7d9b4"],
  ["f29ada02-1240-57d0-a1f8-12a9668ebce3", "8389e333-63bf-43c8-b287-2f063a56a8eb"],
  ["f2cd5ea5-3996-41c1-b168-229b313fb6a8", "a905deaf-cffa-42b5-8ecb-0f231727111d"],
  ["f35f8f3f-fce4-468e-8b36-21955c924212", "caa76ece-67ba-45fc-90d9-031f75bb6f04"],
  ["f3e13bf1-27c2-4bc1-baa3-a19dcf72b7e7", "b12614d6-9abc-4757-9041-2feec5ff738a"],
  ["f4d2b6a5-a08c-401d-9f02-de2c16a81683", "3d114f7f-015a-478f-9fca-0eaf3da83729"],
  ["f4e9c821-fffe-4a03-a560-42ca0b3fc6a1", "a905deaf-cffa-42b5-8ecb-0f231727111d"],
  ["f5b9d118-ad76-56a2-9676-ba25918d27d9", "72906be9-db2e-4bc7-b68e-7690a181dc25"],
  ["f6f17f13-d6bf-4e5b-b3d1-f2fac26463fb", "985fc7b5-b763-4837-8248-a3ca400a7b60"],
  ["f801dbf1-552a-4c13-b7bb-b86715756c2a", "8f728683-4c7c-4c17-85eb-c0ef38b1fe78"],
  ["f88ffd24-766b-5d1e-a94e-d5eeca76c2ea", "7b03cc4f-c47a-4fdc-8792-ca4501db71f3"],
  ["f8d639b1-bba0-5a44-8e23-548bc25483c9", "e2755bb5-bfb8-444f-93ab-c8267e5b7989"],
  ["f92e0485-0fe4-407f-ab85-365cd84d7a44", "226218ad-318e-44ac-b8c4-becc4e1d3d25"],
  ["faaacc08-29c1-4536-b5a1-c91b973f3ff5", "5282244e-a3ac-4337-a6e7-464b07542958"],
  ["fb6a6b2e-45f7-46bd-b130-9dab0bec9517", "1fda1aca-13e1-4313-a346-fd3fc390727f"],
  ["fb937207-12d9-4915-b3fa-6561d65e26e8", "b40c71eb-495d-4434-a70d-dbf2b2b7d9b4"],
  ["fc71b52f-e5cd-4cd0-921f-4af40cf10b2a", "985fc7b5-b763-4837-8248-a3ca400a7b60"],
  ["fcb7b04f-9ced-4a59-a29c-431e1d3d370e", "e71e0062-8820-475c-ad98-10503f76415a"],
  ["fcc893ba-4b94-4d79-8c9f-1bc9c7557833", "9497b162-e911-4553-8e08-e811113aae6d"],
  ["fd3c4145-2310-4402-b309-492dbaa92a10", "b9b10af2-1528-4530-94af-1cefeb092a25"],
];

const literal = (value) => `'${value.replaceAll("'", "''")}'`;

const SQL = `
DO $migration$
DECLARE
  gone uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'plan_offerings' AND column_name = 'product_id'
  ) THEN
    RETURN;
  END IF;

  ALTER TABLE plan_offerings DISABLE TRIGGER USER;
  ALTER TABLE plan_offerings ADD COLUMN offering_id uuid;

  CREATE TEMPORARY TABLE cyc_reviewed (plan_offering_id uuid, offering_id uuid) ON COMMIT DROP;
  INSERT INTO cyc_reviewed VALUES ${REVIEWED.map(([plan, catalog]) => `(${literal(plan)}::uuid, ${literal(catalog)}::uuid)`).join(", ")};
  SELECT r.offering_id INTO gone FROM cyc_reviewed r JOIN plan_offerings p ON p.id = r.plan_offering_id
    WHERE NOT EXISTS (SELECT 1 FROM offerings o WHERE o.id = r.offering_id) LIMIT 1;
  IF gone IS NOT NULL THEN
    RAISE EXCEPTION 'cyc0033: the reviewed list links plan offerings to catalog offering %, which is gone', gone;
  END IF;
  UPDATE plan_offerings p SET offering_id = r.offering_id FROM cyc_reviewed r WHERE p.id = r.plan_offering_id;

  -- One catalog offering for each year's plan offerings that share a product, a name and dates.
  CREATE TEMPORARY TABLE cyc_new_offerings ON COMMIT DROP AS
    SELECT DISTINCT ON (s.fiscal_year, p.product_id, p.name, p.starts_on, p.ends_on)
        gen_random_uuid() AS offering_id, s.fiscal_year, p.product_id, p.name, p.starts_on, p.ends_on,
        p.price_cents, p.capacity
      FROM plan_offerings p JOIN plans pl ON pl.id = p.plan_id JOIN financial_plans s ON s.id = pl.financial_plan_id
      WHERE p.offering_id IS NULL
      ORDER BY s.fiscal_year, p.product_id, p.name, p.starts_on, p.ends_on,
        s.status = 'frozen' DESC, s.effective_from DESC NULLS LAST, p.id;
  INSERT INTO offerings (id, product_id, name, starts_on, ends_on, price_cents, capacity)
    SELECT offering_id, product_id, name, starts_on, ends_on, price_cents, capacity FROM cyc_new_offerings;
  UPDATE plan_offerings p SET offering_id = n.offering_id
    FROM plans pl, financial_plans s, cyc_new_offerings n
    WHERE pl.id = p.plan_id AND s.id = pl.financial_plan_id AND p.offering_id IS NULL
      AND n.fiscal_year = s.fiscal_year AND n.product_id = p.product_id AND n.name = p.name
      AND n.starts_on = p.starts_on AND n.ends_on = p.ends_on;

  ALTER TABLE plan_offerings ALTER COLUMN offering_id SET NOT NULL;
  ALTER TABLE plan_offerings ADD CONSTRAINT plan_offerings_offering_id_foreign
    FOREIGN KEY (offering_id) REFERENCES offerings (id) ON DELETE RESTRICT;
  ALTER TABLE plan_offerings DROP COLUMN product_id, DROP COLUMN name;
  ALTER TABLE plan_offerings ENABLE TRIGGER USER;

  -- Nested, because PL/pgSQL prepares a statement only when it reaches it, and a database without
  -- Directus has none of its tables.
  IF to_regclass('directus_fields') IS NOT NULL THEN
    DELETE FROM directus_relations WHERE many_collection = 'plan_offerings' AND many_field = 'product_id';
    DELETE FROM directus_fields WHERE collection = 'plan_offerings' AND field IN ('product_id', 'name');
    INSERT INTO directus_fields (collection, field, special) VALUES ('plan_offerings', 'offering_id', 'm2o');
    INSERT INTO directus_relations (many_collection, many_field, one_collection, one_field) VALUES
      ('plan_offerings', 'offering_id', 'offerings', NULL);
  END IF;
END
$migration$;
`;

async function up(knex) {
  await knex.raw(SQL);
}

// One way: a plan offering's product and name are its catalog offering's now.
async function down() {}

module.exports = { up, down, REVIEWED, SQL };
