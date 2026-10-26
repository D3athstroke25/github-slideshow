-- Sample projects so a new Groundswell isn't empty. Everything here is flagged sample = true:
-- the app labels these projects "Sample", sample accounts cannot log in, and an admin can
-- remove all of it from Moderation -> Remove sample projects (gs_admin_remove_samples).
-- Safe to re-run: it does nothing if sample projects already exist.
do $seed$
declare
  pj record; rw record; uid uuid; cid uuid; pid uuid; target bigint; total bigint; n int; span interval;
  pick record; at timestamptz; amt bigint;
begin
  if exists (select 1 from projects where sample) then return; end if;

  -- 400 sample backers (no usable password).
  insert into users (username, display_name, pw_hash, sample)
  select 'sample_backer_' || lpad(g::text, 3, '0'), 'Sample backer ' || g, '!', true from generate_series(1, 400) g;

  for pj in select * from jsonb_to_recordset($json$[
    {"creator":"Lantern Table Games","handle":"sample_lantern","title":"Lantern Keepers: a cooperative board game","slug":"lantern-keepers","category":"games","location":"Montreal, QC","currency":"CAD","goal":1500000,"pct":1.24,"days_ago":12,"duration":30,"seed":210,"featured":true,
     "blurb":"Keep the coastal lighthouses burning through one long winter night, together. 1-5 players, 45 minutes.",
     "story":"## Light the way home\n\n**Lantern Keepers** is a cooperative game for 1 to 5 players. Each of you tends a lighthouse on a stormy coast, and the ships out on the water need every one of your lights to make it home.\n\nYou'll trade oil, repair lenses and send signals across the bay, but the storm grows stronger every round. Win together, or lose together.\n\n## What's in the box\n\n- 5 lighthouse boards with rotating lens dials\n- 60 wooden ship tokens\n- 110 storm and tide cards\n- A solo mode with 12 scenarios\n\n> We've played it 400 times with friends, families and strangers at game cafés. It's ready for the table.\n\n## Where the money goes\n\nThe goal covers a first print run of 2,000 copies, tooling for the lens dials, and shipping from our printer in Quebec.",
     "risks":"Board game printing timelines slip. We've built in a two-month buffer and have final quotes from our printer, but a paper shortage could still delay us. We'll post an update every two weeks either way.",
     "faqs":[{"q":"Is there a solo mode?","a":"Yes, with 12 scenarios that get harder as you go."},{"q":"How long does a game take?","a":"About 45 minutes once you know the rules."}],
     "rewards":[{"title":"Print and play","amount":1500,"ships":false,"desc":"A PDF of the whole game to print at home.","items":["Print-and-play PDF"],"m":2},
                {"title":"Lantern Keepers","amount":6500,"ships":true,"shipping":1200,"desc":"The full game, shipped to your door.","items":["Lantern Keepers","Backer-only lighthouse card"],"m":10,"est":"2027-06"},
                {"title":"Keeper's edition","amount":11000,"ships":true,"shipping":1500,"desc":"The game plus wooden lanterns and a cloth map of the bay.","items":["Lantern Keepers","Wooden lantern set","Cloth bay map"],"m":3,"limit":300,"est":"2027-06"}]},
    {"creator":"Ines Albright","handle":"sample_ines","title":"Field Notes from the Edge of the Map","slug":"field-notes-edge-of-the-map","category":"publishing","location":"Edinburgh, UK","currency":"GBP","goal":800000,"pct":0.61,"days_ago":9,"duration":35,"seed":43,
     "blurb":"An illustrated travel journal from 14 islands at the far edge of the North Atlantic.",
     "story":"## Fourteen islands, one notebook\n\nFor two years I travelled to the small islands at the edge of the North Atlantic with a sketchbook and a pocket of pencils. **Field Notes** collects 180 pages of drawings, maps and short essays from those trips.\n\n- 180 pages, cloth bound\n- 120 full-colour illustrations\n- Fold-out map of the whole route\n\nThe book is written and drawn. Your pledge pays for printing, binding and the fold-out map.",
     "risks":"The book is finished, so the main risk is printing. I'm working with a printer I've used before, and I'll share proofs with backers before the full run.",
     "faqs":[{"q":"Will it be in shops?","a":"Maybe later, but backers get the first edition and a signed bookplate."}],
     "rewards":[{"title":"Digital edition","amount":1200,"ships":false,"desc":"The full book as a high-resolution PDF.","items":["PDF edition"],"m":3},
                {"title":"The book","amount":3500,"ships":true,"shipping":800,"desc":"A cloth-bound first edition with a signed bookplate.","items":["Field Notes, first edition","Signed bookplate"],"m":10,"est":"2027-03"},
                {"title":"Book and print","amount":7500,"ships":true,"shipping":1000,"desc":"The book plus an A3 giclée print of your favourite island.","items":["Field Notes, first edition","A3 giclée print"],"m":2,"est":"2027-03"}]},
    {"creator":"Rooftop Fire Co.","handle":"sample_rooftop","title":"Rooftop Fire: small-batch hot sauce","slug":"rooftop-fire-hot-sauce","category":"food","location":"Toronto, ON","currency":"CAD","goal":600000,"pct":0.86,"days_ago":28,"duration":30,"seed":64,
     "blurb":"Three hot sauces from peppers we grow on a downtown rooftop, fermented for 90 days.",
     "story":"## Grown four floors up\n\nWe grow 30 varieties of peppers on the roof of our building, and every autumn we turn them into hot sauce. This year we want to make enough for more than our friends.\n\n- **Smoke Signal**: chipotle and charred onion\n- **Rooftop Gold**: yellow habanero and mango\n- **Ghost Light**: ghost pepper and garlic, for the brave\n\nThe goal pays for a licensed commercial kitchen, bottles and labels.",
     "risks":"We're moving from our home kitchen to a commercial one. If the inspection takes longer than planned, bottles ship a few weeks later.",
     "faqs":[{"q":"How hot is Ghost Light?","a":"Very. Start with one drop."},{"q":"Do you ship outside Canada?","a":"Yes, everywhere except where customs won't allow sauces."}],
     "rewards":[{"title":"One bottle","amount":1400,"ships":true,"shipping":900,"desc":"Your choice of sauce.","items":["One 150 ml bottle"],"m":5,"est":"2027-01"},
                {"title":"The trio","amount":3600,"ships":true,"shipping":1100,"desc":"All three sauces.","items":["Three 150 ml bottles"],"m":10,"est":"2027-01"},
                {"title":"Rooftop dinner","amount":15000,"ships":false,"desc":"Dinner for two on the roof next summer, with a tasting of every sauce.","items":["Dinner for two","The trio"],"m":1,"limit":12,"est":"2027-07"}]},
    {"creator":"Maren Holt","handle":"sample_maren","title":"Quiet Hours: an album recorded in a lighthouse","slug":"quiet-hours-album","category":"music","location":"Twillingate, NL","currency":"CAD","goal":1200000,"pct":0.38,"days_ago":4,"duration":40,"seed":8,
     "blurb":"Nine songs written and recorded over one winter in a working lighthouse.",
     "story":"## Nine songs, one winter\n\nLast winter I lived in a lighthouse on the coast of Newfoundland and wrote one song a week. **Quiet Hours** is those songs, recorded in the lighthouse itself, with the wind and the foghorn left in.\n\nThe goal pays for mixing, mastering and a vinyl pressing.",
     "risks":"Vinyl plants are busy. If pressing is delayed, digital rewards still arrive on time and vinyl follows.",
     "faqs":[{"q":"Will it be on streaming services?","a":"Yes, a month after backers get it."}],
     "rewards":[{"title":"Digital album","amount":1000,"ships":false,"desc":"Download in any format.","items":["Digital album"],"m":10},
                {"title":"Vinyl","amount":3500,"ships":true,"shipping":1200,"desc":"180 g vinyl plus the digital album.","items":["Vinyl LP","Digital album"],"m":6,"est":"2027-05"},
                {"title":"House concert","amount":60000,"ships":false,"desc":"I'll play the album in your living room (Atlantic Canada).","items":["House concert"],"m":0,"limit":5,"est":"2027-08"}]},
    {"creator":"Open Loom Collective","handle":"sample_openloom","title":"Open Loom: an open-source tabletop loom","slug":"open-loom","category":"crafts","location":"Portland, OR","currency":"USD","goal":1800000,"pct":2.1,"days_ago":20,"duration":30,"seed":97,
     "blurb":"A 40 cm rigid heddle loom you can build yourself, with every design file shared freely.",
     "story":"## Weaving for everyone\n\n**Open Loom** is a tabletop loom made from birch plywood and a handful of 3D-printed parts. All the files are open, so anyone can cut one on a laser or CNC machine.\n\nFor everyone else, we're offering kits and finished looms.\n\n- 40 cm weaving width\n- Folds flat for storage\n- Works with any yarn up to worsted weight",
     "risks":"We're producing 10 times more looms than last year. We've added a second laser cutter and a production partner to keep up.",
     "faqs":[{"q":"Are the files really free?","a":"Yes. They're published under a CC BY-SA license today, pledge or not."}],
     "rewards":[{"title":"Supporter","amount":1000,"ships":false,"desc":"Help keep the files free.","items":["Your name in the README"],"m":3},
                {"title":"Loom kit","amount":11900,"ships":true,"shipping":2000,"desc":"Pre-cut parts, hardware and instructions.","items":["Loom kit","Starter yarn"],"m":10,"est":"2027-02"},
                {"title":"Finished loom","amount":18900,"ships":true,"shipping":2500,"desc":"Assembled, oiled and ready to warp.","items":["Finished loom","Starter yarn","Shuttle set"],"m":6,"est":"2027-02"}]},
    {"creator":"Paper Moon Animation","handle":"sample_papermoon","title":"Parallax: an animated short about a mapmaker","slug":"parallax-animated-short","category":"film","location":"Vancouver, BC","currency":"CAD","goal":4000000,"pct":0.23,"days_ago":7,"duration":45,"seed":125,
     "blurb":"A 12-minute hand-drawn film about a cartographer who maps a city that keeps changing.",
     "story":"## A city that won't sit still\n\n**Parallax** follows Odile, a cartographer hired to map a city that rearranges itself every night. It's 12 minutes long and drawn entirely by hand, about 9,000 drawings.\n\nThe script, storyboard and animatic are done. The goal pays a team of six animators for eight months.",
     "risks":"Animation takes a long time. Our schedule is based on our last two shorts, and we'll share progress every month.",
     "faqs":[{"q":"Where will it screen?","a":"We're submitting to festivals, then releasing it online for backers."}],
     "rewards":[{"title":"Watch it first","amount":1500,"ships":false,"desc":"A private link to the finished film before release.","items":["Early private screening link"],"m":10},
                {"title":"Art book","amount":5500,"ships":true,"shipping":1200,"desc":"A 96-page book of drawings from the film.","items":["Parallax art book","Early screening link"],"m":4,"est":"2027-11"},
                {"title":"Original drawing","amount":25000,"ships":true,"shipping":1500,"desc":"A framed, hand-drawn frame from the film.","items":["Framed original drawing","Art book"],"m":1,"limit":40,"est":"2027-11"}]},
    {"creator":"Pocket Weather","handle":"sample_pocketwx","title":"Pocket Weather: an open-hardware weather station","slug":"pocket-weather","category":"technology","location":"Berlin, DE","currency":"EUR","goal":1500000,"pct":0.94,"days_ago":28,"duration":29,"seed":181,
     "blurb":"A solar-powered weather station the size of a deck of cards, with open firmware and no subscription.",
     "story":"## Your own weather, no cloud required\n\n**Pocket Weather** measures temperature, humidity, pressure, wind and rain, runs on a small solar panel, and sends readings to your own computer over Wi-Fi. No accounts, no subscriptions.\n\n- Open firmware and schematics\n- 2-year battery with solar top-up\n- Works with Home Assistant out of the box",
     "risks":"Electronic components can have long lead times. We've already bought the main chips for the first 2,000 units.",
     "faqs":[{"q":"Does it need an app?","a":"No. It serves a small web page on your network, and speaks MQTT."}],
     "rewards":[{"title":"Bare board","amount":4900,"ships":true,"shipping":800,"desc":"The assembled circuit board, for tinkerers.","items":["Assembled board"],"m":4,"est":"2027-04"},
                {"title":"Pocket Weather","amount":8900,"ships":true,"shipping":1000,"desc":"The complete station with case, solar panel and mount.","items":["Pocket Weather station","Pole mount"],"m":10,"est":"2027-04"}]},
    {"creator":"The Neighborhood Darkroom","handle":"sample_darkroom","title":"The Neighborhood Darkroom","slug":"neighborhood-darkroom","category":"photography","location":"Melbourne, AU","currency":"AUD","goal":900000,"pct":1.32,"days_ago":40,"duration":30,"seed":56,
     "blurb":"A community film darkroom with open hours, classes and shared enlargers.",
     "story":"## Film is back\n\nWe're turning an old shopfront into a shared darkroom: six enlargers, a film processing station, and open hours every evening. Members pay a small monthly fee; backers get free months and classes.",
     "risks":"Fit-out costs could run over. We've priced everything with two contractors.",
     "faqs":[{"q":"Do I need experience?","a":"No. Our beginner class covers everything."}],
     "rewards":[{"title":"Thank you","amount":1000,"ships":false,"desc":"Your name on the darkroom wall.","items":["Name on the wall"],"m":4},
                {"title":"Three free months","amount":9000,"ships":false,"desc":"Three months of membership.","items":["3 months membership"],"m":6,"est":"2026-12"},
                {"title":"Beginner class","amount":18000,"ships":false,"desc":"A four-week class plus three months of membership.","items":["4-week class","3 months membership"],"m":3,"est":"2027-01"}]},
    {"creator":"Sketchbook Comics","handle":"sample_sketchbook","title":"Sketchbook Comics Anthology, Volume 2","slug":"sketchbook-comics-vol-2","category":"comics","location":"Austin, TX","currency":"USD","goal":750000,"pct":0.16,"days_ago":1,"duration":30,"seed":72,
     "blurb":"Twenty short comics by twenty new artists, in one 240-page book.",
     "story":"## Twenty new voices\n\nVolume 1 sold out in a month. **Volume 2** brings together twenty short comics from artists publishing for the first time, in genres from quiet slice-of-life to cosmic horror.\n\nEvery artist is paid a flat page rate, and that's most of the goal.",
     "risks":"Twenty artists means twenty schedules. Every story is already at the pencils stage.",
     "faqs":[{"q":"Do I need Volume 1?","a":"No, every story stands alone."}],
     "rewards":[{"title":"Digital anthology","amount":1200,"ships":false,"desc":"PDF and CBZ.","items":["Digital anthology"],"m":6},
                {"title":"Paperback","amount":3000,"ships":true,"shipping":700,"desc":"The 240-page paperback.","items":["Paperback","Digital anthology"],"m":10,"est":"2027-05"}]}
  ]$json$::jsonb) as x(creator text, handle text, title text, slug text, category text, location text, currency text, goal bigint,
     pct numeric, days_ago int, duration int, seed int, featured boolean, blurb text, story text, risks text, faqs jsonb, rewards jsonb)
  loop
    insert into users (username, display_name, pw_hash, sample, bio, location)
      values (pj.handle, pj.creator, '!', true, 'Sample creator account used to show how Groundswell works.', pj.location)
      returning id into cid;
    insert into projects (slug, creator_id, status, title, blurb, category, location, cover_seed, story, risks, faqs, currency,
        goal_cents, duration_days, launched_at, deadline, featured, sample)
      values (pj.slug, cid, 'live', pj.title, pj.blurb, pj.category, pj.location, pj.seed, pj.story, pj.risks, pj.faqs, pj.currency,
        pj.goal, pj.duration, now() - make_interval(days => pj.days_ago) - interval '3 hours',
        now() - make_interval(days => pj.days_ago) - interval '3 hours' + make_interval(days => pj.duration), coalesce(pj.featured, false), true)
      returning id into pid;
    insert into rewards (project_id, title, description, items, amount_cents, ships, shipping_cents, est_delivery, limit_qty)
      select pid, r->>'title', r->>'desc', r->'items', (r->>'amount')::bigint, (r->>'ships')::boolean,
             coalesce((r->>'shipping')::bigint, 0), (nullif(r->>'est', '') || '-01')::date, (r->>'limit')::int
      from jsonb_array_elements(pj.rewards) r;

    -- Pledges from sample backers until the target percentage is reached; earlier days get more.
    target := round(pj.goal * pj.pct); total := 0; n := 0;
    span := least(now(), now() - make_interval(days => pj.days_ago) + make_interval(days => pj.duration)) - (now() - make_interval(days => pj.days_ago));
    for uid in select id from users where sample and username like 'sample_backer_%' order by random() loop
      exit when total >= target;
      select rw2.id, rw2.amount_cents + case when rw2.ships then rw2.shipping_cents else 0 end as base, rw2.limit_qty,
             (select count(*) from pledges x where x.reward_id = rw2.id) as used
        into pick
        from rewards rw2 cross join lateral (select (r->>'m')::int m from jsonb_array_elements(pj.rewards) r where r->>'title' = rw2.title) w
        where rw2.project_id = pid and w.m > 0
        order by random() * 10 / w.m limit 1;
      if pick.limit_qty is not null and pick.used >= pick.limit_qty then continue; end if;
      amt := pick.base + case when random() < 0.2 then (1 + floor(random() * 4)) * 500 else 0 end;
      n := n + 1;
      at := now() - make_interval(days => pj.days_ago) + span * power(random(), 1.7);
      insert into pledges (project_id, backer_id, reward_id, amount_cents, shipping_cents, backer_no, created_at, updated_at)
        values (pid, uid, pick.id, amt, (select case when ships then shipping_cents else 0 end from rewards where id = pick.id), n, at, at);
      total := total + amt;
    end loop;
    -- Renumber backers in time order and date the funding events to match.
    update pledges x set backer_no = o.rn from (select id, row_number() over (order by created_at) rn from pledges where project_id = pid) o where x.id = o.id;
    delete from pledge_events where project_id = pid;
    insert into pledge_events (project_id, at, delta_cents, delta_backers) select project_id, created_at, amount_cents, 1 from pledges where project_id = pid;
  end loop;

  -- A couple of creator updates.
  insert into updates (project_id, n, title, body, backers_only, created_at)
  select id, 1, 'We''re funded! Thank you',
    'We hit our goal in **nine days**. Thank you to every one of you.' || chr(10) || chr(10) || 'Next up: final art for the storm cards, and a stretch goal we think you''ll like.', false, now() - interval '3 days'
  from projects where slug = 'lantern-keepers';
  insert into updates (project_id, n, title, body, backers_only, created_at)
  select id, 1, 'First loom off the new laser', 'The second laser cutter is installed and the first production loom is assembled. Photos next week.', false, now() - interval '6 days'
  from projects where slug = 'open-loom';
end
$seed$;

-- The darkroom finished last week; settle it now so it appears under "Recently funded".
select gs_settle();
