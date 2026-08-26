// The 13 commercial-edition cases, hand-written from the imqueue.com pages last session and
// re-checked against them now, plus one added so all seven addressable com pages are covered.
//
// These were never contaminated — they were read off the pages from the start:
//   /license/ is titled "Do you need a commercial license for @imqueue?"
//   /pricing/ is where you get one and what it costs
//   /support/ promises SLA-backed priority support, guaranteed response times and indemnification
//   /contact/ says in as many words it is for anything that is NOT a licensing quote
// Section-level targeting is unavailable here: the peer feed has 8 records and none carries a
// #fragment.
import type { JudgedQuery } from './types.ts';

export const PEER: readonly JudgedQuery[] = [
  ['do I need a commercial license for imqueue', '/license/', ['/pricing/'], 'licensing'],
  ['can I ship imqueue inside a closed source product', '/license/', ['/pricing/'], 'licensing'],
  ['is GPL-3.0 ok for a commercial project', '/license/', ['/pricing/'], 'licensing'],
  ['how much does a commercial imqueue license cost', '/pricing/', ['/license/'], 'licensing'],
  ['buy a commercial license for imqueue', '/pricing/', ['/license/', '/contact/'], 'licensing'],
  ['where do I ask for a licensing quote', '/pricing/', ['/contact/'], 'licensing'],
  ['imqueue commercial edition', '/', ['/license/', '/pricing/'], 'licensing'],
  ['SLA backed commercial support for imqueue', '/support/', ['/pricing/'], 'commercial support'],
  ['guaranteed response time from the imqueue maintainers', '/support/',
    ['/contact/', '/pricing/'], 'commercial support'],
  ['does commercial support include indemnification', '/support/', ['/license/'], 'commercial support'],
  ['how do I contact the imqueue maintainers', '/contact/', ['/support/'], 'commercial support'],
  ['send the imqueue team a message with an attachment', '/contact/', [], 'commercial support'],
  ['what happens to the data I put in the enquiry form', '/privacy/', [], 'site legal'],
  ['terms of use for imqueue.com', '/terms/', [], 'site legal'],
];
