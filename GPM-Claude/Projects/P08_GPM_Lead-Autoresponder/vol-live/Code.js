function autoResponder() {
  // Prevents overlapping executions (e.g. a large backlog after reactivation
  // taking longer than the 1-minute trigger interval) from double-sending —
  // the per-address cache check below only protects a single execution.
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;

  try {
    autoResponder_run_();
  } finally {
    lock.releaseLock();
  }
}

function autoResponder_run_() {
  var searchQuery = 'subject:(Leonard (interest OR interested) (Victory OR 900)) is:unread';
  var threads = GmailApp.search(searchQuery);
  var jodyEmail = "Jody@greenpropertymgt.com";
  var tourLink = "https://selftours.butterflymx.com/victory-on-leonard";
  var jodyTourLink = "https://greenproperty11.appfolio.com/listings/showings/new?listable_uid=8b49a2d3-2184-444f-852e-580551dcc0e6&source=Website";
  var senderName = "Victory Leasing Team";
  
  // Initialize Cache
  var cache = CacheService.getScriptCache();

  for (var i = 0; i < threads.length; i++) {
    var messages = threads[i].getMessages();
    var lastMessage = messages[messages.length - 1];
    
    var prospectEmail = lastMessage.getReplyTo();
    var fromHeader = lastMessage.getFrom();
    var name = fromHeader.split("<")[0].trim();
    var firstName = name.split(" ")[0];
    
    if (!firstName || firstName.includes("@") || firstName === "") {
      firstName = "there";
    }

    var subject = "Victory on Leonard - Schedule your Tour";
    var htmlBody = `
      Hello ${firstName},<br><br>
      Welcome to Victory on Leonard. This is an exciting time to join us, currently we only have studios available to tour!<br><br>
      <strong><a href="${tourLink}">TOUR VICTORY ON LEONARD</a></strong><br><br>
      Before you tour, here's what we screen for:<br>
      - Gross income: 3x the monthly rent<br>
      - Credit score: 625 or higher<br>
      - No prior evictions<br>
      - Clean rental history and background check<br><br>
      If that's you, our address is 900 Leonard St NW, Grand Rapids, MI 49504. Schedule your self-guided tour above. Tours are available from 6 AM to 10 PM, 7 days a week. Units don't sit long. Grab your spot.<br><br>
      If you prefer me to show you around the property myself, I'll reach out to you shortly.<br><br>
      Thank you,<br>
      Jody Betsch<br>
      Green Property Management
    `;


    // Check Cooldown Cache (15 minutes = 900 seconds)
    var cachedFlag = cache.get(prospectEmail);
    
    if (!cachedFlag) {
      GmailApp.sendEmail(prospectEmail, subject, "", {
        htmlBody: htmlBody,
        name: senderName,
        replyTo: jodyEmail
      });
      
      // Set the flag for 15 minutes
      cache.put(prospectEmail, "sent", 900);
    }
    
    // Always mark as read and Archive so we don't process the same thread again
    threads[i].markRead();
    threads[i].moveToArchive();
  }
}